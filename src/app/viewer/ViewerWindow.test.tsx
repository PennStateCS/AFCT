/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { VIEWER_ALIVE_KEY, VIEWER_CHANNEL, type ViewerTab } from '@/lib/viewer-tabs';

/** How many times a viewer for each file has been built, so a remount is visible. */
const mounts = new Map<string, number>();

// The viewer itself is exercised by its own tests; here it only has to say which file it was
// given, so switching tabs can be seen to switch machines, and count its own mounts, which is
// how "the zoom survived" is checked without a layout engine to zoom.
vi.mock('./ViewerClient', () => ({
  ViewerClient: ({ src }: { src: string }) => {
    React.useEffect(() => {
      mounts.set(src, (mounts.get(src) ?? 0) + 1);
    }, [src]);
    return <div data-testid="viewer" data-src={src} />;
  },
}));
vi.mock('@/components/viewer/ViewerMenubar', () => ({
  ViewerMenubar: ({
    downloadHref,
    properties,
  }: {
    downloadHref: string;
    properties?: { rows: { label: string; value: string }[] } | null;
  }) => (
    <div
      data-testid="menubar"
      data-download={downloadHref}
      data-properties={properties?.rows[0]?.value ?? ''}
    />
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

/** The file the reader is actually looking at: the one viewer that is not hidden. */
const showing = () => {
  const visible = screen
    .getAllByTestId('viewer')
    .filter((v) => !v.closest('[inert]'))
    .map((v) => v.getAttribute('data-src'));
  expect(visible).toHaveLength(1);
  return visible[0];
};

const renderWindow = (
  tabs: ViewerTab[],
  active = 0,
  properties: Record<string, { rows: { label: string; value: string }[] } | null> = {},
) =>
  render(<ViewerWindow initialTabs={tabs} initialActive={active} initialProperties={properties} />);

beforeEach(() => {
  mounts.clear();
  TestChannel.open = [];
  vi.stubGlobal('BroadcastChannel', TestChannel);
  // The properties fetch for a tab the server never saw. Not what these tests are about.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  window.localStorage.clear();
  window.sessionStorage.clear();
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
    expect(showing()).toContain('b.jff');
  });

  it('switches the machine on screen when another tab is chosen', () => {
    renderWindow([tab('a.jff'), tab('b.jff')]);
    expect(showing()).toContain('a.jff');
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(showing()).toContain('b.jff');
  });

  it('closes a tab and keeps a neighbour showing', () => {
    renderWindow([tab('a.jff'), tab('b.jff')], 1);
    fireEvent.click(screen.getByLabelText('Close b.jff'));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['a.jff']);
    expect(showing()).toContain('a.jff');
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
    expect(showing()).toContain('b.jff');
  });

  it('selects the tab it already has rather than opening a second one', () => {
    renderWindow([tab('a.jff'), tab('b.jff')], 1);
    send(tab('a.jff'));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(showing()).toContain('a.jff');
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

describe('what a tab keeps while another one is on screen', () => {
  it('does not rebuild a machine that is switched away from and back to', () => {
    // The bug this fixes: the viewer was keyed on the active file, so every tab click threw
    // the graph away and built a new one. Zoom, the arrangement and the undo history went
    // with it, which looked like the zoom resetting itself.
    renderWindow([tab('a.jff'), tab('b.jff')]);
    const first = screen.getByTestId('viewer').getAttribute('data-src');

    fireEvent.click(screen.getAllByRole('tab')[1]);
    fireEvent.click(screen.getAllByRole('tab')[0]);

    expect(mounts.get(first!)).toBe(1);
  });

  it('holds the tab it left behind in the page, hidden rather than removed', () => {
    renderWindow([tab('a.jff'), tab('b.jff')]);
    fireEvent.click(screen.getAllByRole('tab')[1]);

    const viewers = screen.getAllByTestId('viewer');
    expect(viewers).toHaveLength(2);
    // Hidden ones are out of the accessibility tree and the tab order, so a reader is not
    // walked through machines nobody can see.
    expect(viewers.filter((v) => v.closest('[inert]'))).toHaveLength(1);
  });

  it('does not build a tab nobody has opened yet', () => {
    // What keeps a window of tabs from fetching a dozen students' files, and the audit trail
    // from recording a dozen views nobody made.
    renderWindow([tab('a.jff'), tab('b.jff'), tab('c.jff')]);
    expect(screen.getAllByTestId('viewer')).toHaveLength(1);
    expect(mounts.has('/api/files/submissions/c.jff')).toBe(false);
  });

  it('throws away the remembered view when a tab is closed', () => {
    // Closing is how a reader discards an arrangement. Leaving it in storage would bring it
    // back the next time the same file was opened, which nobody asked for.
    window.sessionStorage.setItem('afct.viewer.view.submissions:b.jff', '{"v":1}');
    renderWindow([tab('a.jff'), tab('b.jff')]);
    fireEvent.click(screen.getByLabelText('Close b.jff'));
    expect(window.sessionStorage.getItem('afct.viewer.view.submissions:b.jff')).toBeNull();
  });

  it('starts clean when a closed file is opened again', () => {
    // Closing a tab is the way to discard an arrangement, so re-opening the same file must
    // build a new graph rather than appear to remember one that has gone.
    renderWindow([tab('a.jff'), tab('b.jff')]);
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(mounts.get('/api/files/submissions/b.jff')).toBe(1);

    fireEvent.click(screen.getByLabelText('Close b.jff'));
    const opener = new TestChannel(VIEWER_CHANNEL);
    act(() => opener.postMessage({ type: 'open-tab', tab: tab('b.jff') }));
    opener.close();

    expect(mounts.get('/api/files/submissions/b.jff')).toBe(2);
  });
});

describe('the menu bar belongs to the tab on screen', () => {
  // Two of the menu's entries do not go through the viewer at all: the Download link and the
  // Properties panel are handed down from here. They have to follow the selected tab like
  // everything else, or a reader downloads one student's file while looking at another's.

  it('offers the showing tab as the download, marked as a download', () => {
    renderWindow([tab('a.jff'), tab('b.jff')]);
    expect(screen.getByTestId('menubar').getAttribute('data-download')).toBe(
      '/api/files/submissions/a.jff?download=1',
    );

    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByTestId('menubar').getAttribute('data-download')).toBe(
      '/api/files/submissions/b.jff?download=1',
    );
  });

  it("shows the showing tab's properties", () => {
    renderWindow([tab('a.jff'), tab('b.jff')], 0, {
      'submissions:a.jff': { rows: [{ label: 'Student', value: 'Ada' }] },
      'submissions:b.jff': { rows: [{ label: 'Student', value: 'Grace' }] },
    });
    expect(screen.getByTestId('menubar').getAttribute('data-properties')).toBe('Ada');

    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByTestId('menubar').getAttribute('data-properties')).toBe('Grace');
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
