/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { VIEWER_ALIVE_KEY, VIEWER_CHANNEL, type ViewerTab } from '@/lib/viewer-tabs';

// The viewer itself is exercised by its own tests; here it only has to say which file it was
// given, so switching tabs can be seen to switch machines.
vi.mock('./ViewerClient', () => ({
  ViewerClient: ({ src }: { src: string }) => <div data-testid="viewer" data-src={src} />,
}));
vi.mock('@/components/viewer/ViewerMenubar', () => ({
  ViewerMenubar: ({ downloadHref }: { downloadHref: string }) => (
    <div data-testid="menubar" data-download={downloadHref} />
  ),
}));

import { ViewerWindow } from './ViewerWindow';

/**
 * jsdom does not implement BroadcastChannel, so the handshake is unreachable without one.
 * A stub that delivers to the other open channels of the same name is enough: what is being
 * tested is that the window listens and appends, not the browser's delivery.
 */
class TestChannel {
  static open: TestChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public name: string) {
    TestChannel.open.push(this);
  }
  postMessage(data: unknown) {
    for (const other of TestChannel.open) {
      if (other !== this && other.name === this.name) {
        other.onmessage?.({ data } as MessageEvent);
      }
    }
  }
  close() {
    TestChannel.open = TestChannel.open.filter((c) => c !== this);
  }
}

const tab = (file: string, name = file): ViewerTab => ({
  kind: 'submissions',
  file,
  type: 'FA',
  name,
  title: `${name} heading`,
});

const renderWindow = (tabs: ViewerTab[], active = 0) =>
  render(<ViewerWindow initialTabs={tabs} initialActive={active} initialProperties={{}} />);

beforeEach(() => {
  TestChannel.open = [];
  vi.stubGlobal('BroadcastChannel', TestChannel);
  // The properties fetch for a tab the server never saw. Not what these tests are about.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the tab strip', () => {
  it('shows one tab per open file, with the active one selected', () => {
    renderWindow([tab('a.jff'), tab('b.jff')], 1);
    const strip = screen.getAllByRole('tab');
    expect(strip.map((t) => t.textContent)).toEqual(['a.jff', 'b.jff']);
    expect(strip[1].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('viewer').getAttribute('data-src')).toContain('b.jff');
  });

  it('switches the machine on screen when another tab is chosen', () => {
    renderWindow([tab('a.jff'), tab('b.jff')]);
    expect(screen.getByTestId('viewer').getAttribute('data-src')).toContain('a.jff');
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByTestId('viewer').getAttribute('data-src')).toContain('b.jff');
  });

  it('closes a tab and keeps a neighbour showing', () => {
    renderWindow([tab('a.jff'), tab('b.jff')], 1);
    fireEvent.click(screen.getByLabelText('Close b.jff'));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['a.jff']);
    expect(screen.getByTestId('viewer').getAttribute('data-src')).toContain('a.jff');
  });

  it('says so plainly when the last tab is closed', () => {
    renderWindow([tab('a.jff')]);
    fireEvent.click(screen.getByLabelText('Close a.jff'));
    expect(screen.queryByTestId('viewer')).toBeNull();
    expect(screen.getByText(/No file is open/i)).toBeTruthy();
  });

  it('keeps the URL in step, so a refresh restores the same set', () => {
    renderWindow([tab('a.jff'), tab('b.jff')]);
    fireEvent.click(screen.getAllByRole('tab')[1]);
    const search = new URLSearchParams(window.location.search);
    expect(search.get('active')).toBe('1');
    expect(search.get('tabs')).toContain('b.jff');
  });
});

describe('a file sent from another window', () => {
  const send = (t: ViewerTab) => {
    const opener = new TestChannel(VIEWER_CHANNEL);
    act(() => {
      opener.postMessage({ type: 'open-tab', tab: t });
    });
    opener.close();
  };

  it('opens as a new tab and comes to the front', () => {
    renderWindow([tab('a.jff')]);
    send(tab('b.jff'));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['a.jff', 'b.jff']);
    expect(screen.getByTestId('viewer').getAttribute('data-src')).toContain('b.jff');
  });

  it('selects the tab it already has rather than opening a second one', () => {
    renderWindow([tab('a.jff'), tab('b.jff')], 1);
    send(tab('a.jff'));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByTestId('viewer').getAttribute('data-src')).toContain('a.jff');
  });

  it('ignores a message that is not asking for a tab', () => {
    renderWindow([tab('a.jff')]);
    const opener = new TestChannel(VIEWER_CHANNEL);
    act(() => {
      opener.postMessage({ type: 'something-else', tab: tab('b.jff') });
      opener.postMessage({ type: 'open-tab' });
    });
    opener.close();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });
});

describe('the heartbeat that lets an opener find this window', () => {
  it('is written while the window is open and cleared when it goes', () => {
    const view = renderWindow([tab('a.jff')]);
    const beat = Number(window.localStorage.getItem(VIEWER_ALIVE_KEY));
    expect(Date.now() - beat).toBeLessThan(1000);
    view.unmount();
    expect(window.localStorage.getItem(VIEWER_ALIVE_KEY)).toBeNull();
  });
});
