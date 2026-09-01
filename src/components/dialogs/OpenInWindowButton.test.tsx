/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { VIEWER_WINDOW_NAME } from '@/lib/viewer-link';
import { VIEWER_ALIVE_KEY, VIEWER_ALIVE_TIMEOUT_MS, type ViewerTab } from '@/lib/viewer-tabs';
import { OpenInWindowButton } from './OpenInWindowButton';

const posted: unknown[] = [];

/** jsdom has no BroadcastChannel; this records what the button would have sent. */
class TestChannel {
  constructor(public name: string) {}
  postMessage(data: unknown) {
    posted.push(data);
  }
  close() {}
}

const TAB: ViewerTab = {
  kind: 'submissions',
  file: 'a.jff',
  type: 'FA',
  name: 'a.jff',
  title: 'Ada, Problem 2',
};
const HREF = '/viewer?kind=submissions&file=a.jff&type=FA';

let open: ReturnType<typeof vi.fn>;
let focus: ReturnType<typeof vi.fn>;

beforeEach(() => {
  posted.length = 0;
  focus = vi.fn();
  open = vi.fn().mockReturnValue({ focus });
  vi.stubGlobal('BroadcastChannel', TestChannel);
  window.open = open as unknown as typeof window.open;
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const click = () => {
  render(<OpenInWindowButton href={HREF} tab={TAB} />);
  fireEvent.click(screen.getByRole('button', { name: /open in the viewer/i }));
};

describe('opening a file in the standalone viewer', () => {
  it('opens a window when none is listening', () => {
    click();
    expect(posted).toHaveLength(0);
    expect(open).toHaveBeenCalledWith(HREF, VIEWER_WINDOW_NAME);
  });

  it('opens the window under a name the browser will let it find again', () => {
    // `noopener` makes the browser treat the name as `_blank`, so a later open by that name
    // gets a fresh window instead of this one. Proved in Chromium: the reuse attempt made a
    // third window with it and none without. Everything about tabs rests on this.
    click();
    const features = open.mock.calls[0][2];
    expect(features ?? '').not.toContain('noopener');
    expect(features ?? '').not.toContain('noreferrer');
  });

  it('asks an open window for a tab instead of replacing what is in it', () => {
    window.localStorage.setItem(VIEWER_ALIVE_KEY, String(Date.now()));
    click();
    expect(posted).toEqual([{ type: 'open-tab', tab: TAB }]);
    // An empty URL returns the window without navigating it, which is what saves the tabs
    // it already has. Passing HREF here would throw them away.
    expect(open).toHaveBeenCalledWith('', VIEWER_WINDOW_NAME);
    expect(focus).toHaveBeenCalled();
  });

  it('treats a stale heartbeat as no window, rather than messaging one that has gone', () => {
    window.localStorage.setItem(VIEWER_ALIVE_KEY, String(Date.now() - VIEWER_ALIVE_TIMEOUT_MS - 1));
    click();
    expect(posted).toHaveLength(0);
    expect(open).toHaveBeenCalledWith(HREF, VIEWER_WINDOW_NAME);
  });

  it('opens a window when the browser has no BroadcastChannel at all', () => {
    // Safari had none until recently, and it is still absent under some privacy settings.
    vi.stubGlobal('BroadcastChannel', undefined);
    window.localStorage.setItem(VIEWER_ALIVE_KEY, String(Date.now()));
    click();
    expect(open).toHaveBeenCalledWith(HREF, VIEWER_WINDOW_NAME);
  });
});
