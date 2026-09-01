import { describe, it, expect } from 'vitest';

import { tabKey, MAX_VIEWER_TABS, type ViewerTab } from './viewer-tabs';
import {
  activeTab,
  applyDrop,
  closeTab,
  dropZone,
  emptyLayout,
  focusPane,
  focusedTab,
  isShowing,
  layoutToSearch,
  moveTabToPane,
  openTab,
  paneAtPoint,
  paneCount,
  paneOf,
  readLayout,
  selectTab,
  splitTabToSide,
  tabsInPane,
  type ViewerLayout,
} from './viewer-panes';

const tab = (file: string): ViewerTab => ({
  kind: 'submissions',
  file,
  type: 'FA',
  name: file,
  title: `${file} heading`,
});

const key = (file: string) => tabKey(tab(file));

/** A window with these files open, all on the left, showing the first. */
const layoutOf = (...files: string[]): ViewerLayout =>
  files.reduce((layout, file) => openTab(layout, tab(file)), emptyLayout());

const names = (tabs: ViewerTab[]) => tabs.map((t) => t.file);

describe('one pane, which is every window until somebody splits one', () => {
  it('opens tabs on the left and shows the newest', () => {
    const layout = layoutOf('a.jff', 'b.jff');
    expect(paneCount(layout)).toBe(1);
    expect(names(tabsInPane(layout, 0))).toEqual(['a.jff', 'b.jff']);
    expect(activeTab(layout, 0)?.file).toBe('b.jff');
    expect(activeTab(layout, 1)).toBeNull();
  });

  it('selects a file that is already open rather than opening it twice', () => {
    // A second copy of one file would share its remembered view and its React key with the
    // first, and the reader would have no way to tell the two apart.
    const layout = openTab(layoutOf('a.jff', 'b.jff'), tab('a.jff'));
    expect(layout.tabs).toHaveLength(2);
    expect(activeTab(layout, 0)?.file).toBe('a.jff');
  });

  it('drops the oldest tab once the window is full', () => {
    const files = Array.from({ length: MAX_VIEWER_TABS + 1 }, (_, i) => `f${i}.jff`);
    const layout = layoutOf(...files);
    expect(layout.tabs).toHaveLength(MAX_VIEWER_TABS);
    expect(names(layout.tabs)[0]).toBe('f1.jff');
  });

  it('shows another tab when the one on screen is closed', () => {
    const layout = closeTab(layoutOf('a.jff', 'b.jff'), key('b.jff'));
    expect(activeTab(layout, 0)?.file).toBe('a.jff');
  });

  it('ends up empty, and says so, when the last tab closes', () => {
    const layout = closeTab(layoutOf('a.jff'), key('a.jff'));
    expect(layout.tabs).toHaveLength(0);
    expect(focusedTab(layout)).toBeNull();
  });
});

describe('splitting a tab out to one side', () => {
  it('puts the dragged file on the right and the rest on the left', () => {
    const layout = splitTabToSide(layoutOf('a.jff', 'b.jff'), key('b.jff'), 'right');
    expect(paneCount(layout)).toBe(2);
    expect(names(tabsInPane(layout, 0))).toEqual(['a.jff']);
    expect(names(tabsInPane(layout, 1))).toEqual(['b.jff']);
  });

  it('puts the dragged file on the left when that is the side it was dropped on', () => {
    const layout = splitTabToSide(layoutOf('a.jff', 'b.jff'), key('b.jff'), 'left');
    expect(names(tabsInPane(layout, 0))).toEqual(['b.jff']);
    expect(names(tabsInPane(layout, 1))).toEqual(['a.jff']);
  });

  it('focuses the pane the dragged file landed in, and shows it there', () => {
    // The reader dragged this one somewhere on purpose. The menu bar has to act on it.
    const layout = splitTabToSide(layoutOf('a.jff', 'b.jff'), key('b.jff'), 'right');
    expect(layout.focused).toBe(1);
    expect(focusedTab(layout)?.file).toBe('b.jff');
  });

  it('leaves each pane showing something', () => {
    const layout = splitTabToSide(layoutOf('a.jff', 'b.jff', 'c.jff'), key('c.jff'), 'right');
    expect(activeTab(layout, 0)?.file).toBe('a.jff');
    expect(activeTab(layout, 1)?.file).toBe('c.jff');
  });

  it('refuses to split the only open file', () => {
    // It would leave one pane holding nothing, which is a window with one pane and half the
    // screen wasted.
    const layout = layoutOf('a.jff');
    expect(splitTabToSide(layout, key('a.jff'), 'right')).toBe(layout);
  });

  it('ignores a file that is not open', () => {
    const layout = layoutOf('a.jff', 'b.jff');
    expect(splitTabToSide(layout, key('gone.jff'), 'right')).toBe(layout);
  });
});

describe('moving a tab between two panes', () => {
  const split = () => splitTabToSide(layoutOf('a.jff', 'b.jff', 'c.jff'), key('c.jff'), 'right');

  it('moves it and focuses where it went', () => {
    const layout = moveTabToPane(split(), key('a.jff'), 1);
    expect(names(tabsInPane(layout, 1))).toEqual(['a.jff', 'c.jff']);
    expect(layout.focused).toBe(1);
    expect(activeTab(layout, 1)?.file).toBe('a.jff');
  });

  it('collapses back to one pane when the last tab leaves a side', () => {
    // How somebody undoes a split, so it is allowed here even though the split that made the
    // pane would have been refused.
    const layout = moveTabToPane(split(), key('c.jff'), 0);
    expect(paneCount(layout)).toBe(1);
    expect(names(tabsInPane(layout, 0))).toEqual(['a.jff', 'b.jff', 'c.jff']);
  });

  it('collapses when the last tab on a side is closed instead', () => {
    const layout = closeTab(split(), key('c.jff'));
    expect(paneCount(layout)).toBe(1);
    expect(layout.focused).toBe(0);
  });

  it('moves everything left when the left pane empties, rather than leaving a gap', () => {
    const layout = closeTab(closeTab(split(), key('a.jff')), key('b.jff'));
    expect(paneCount(layout)).toBe(1);
    expect(names(tabsInPane(layout, 0))).toEqual(['c.jff']);
    expect(activeTab(layout, 0)?.file).toBe('c.jff');
  });

  it('just focuses the pane when the tab is already there', () => {
    const layout = moveTabToPane(focusPane(split(), 0), key('c.jff'), 1);
    expect(layout.focused).toBe(1);
    expect(paneCount(layout)).toBe(2);
  });

  it('collapses when eviction empties a side', () => {
    // The window is capped, so opening enough files can push the last one out of a pane.
    let layout = splitTabToSide(layoutOf('a.jff', 'b.jff'), key('a.jff'), 'left');
    expect(paneCount(layout)).toBe(2);
    for (let i = 0; i < MAX_VIEWER_TABS; i += 1) layout = openTab(layout, tab(`f${i}.jff`));
    expect(names(layout.tabs)).not.toContain('a.jff');
    expect(paneCount(layout)).toBe(1);
  });
});

describe('which tab is on screen', () => {
  it('is one per pane, not one per window', () => {
    const layout = splitTabToSide(layoutOf('a.jff', 'b.jff', 'c.jff'), key('c.jff'), 'right');
    expect(isShowing(layout, tab('a.jff'))).toBe(true);
    expect(isShowing(layout, tab('c.jff'))).toBe(true);
    // Behind a.jff in the left pane.
    expect(isShowing(layout, tab('b.jff'))).toBe(false);
  });

  it('follows a selection, and takes focus with it', () => {
    const layout = selectTab(
      splitTabToSide(layoutOf('a.jff', 'b.jff', 'c.jff'), key('c.jff'), 'right'),
      key('b.jff'),
    );
    expect(activeTab(layout, 0)?.file).toBe('b.jff');
    expect(layout.focused).toBe(0);
    // The other pane keeps showing what it was showing.
    expect(activeTab(layout, 1)?.file).toBe('c.jff');
  });
});

describe('where a dragged tab would land', () => {
  const rect = { left: 100, width: 800 };

  it('offers a split at either edge of a single pane', () => {
    expect(dropZone(150, rect, 1)).toEqual({ kind: 'split', side: 'left' });
    expect(dropZone(850, rect, 1)).toEqual({ kind: 'split', side: 'right' });
  });

  it('offers nothing across the middle, so dragging past does not keep suggesting one', () => {
    expect(dropZone(500, rect, 1)).toBeNull();
  });

  it('treats each whole half as a target once both panes exist', () => {
    // The panes are already there, so a drop anywhere in one means that one. There is no
    // third thing it could mean.
    expect(dropZone(200, rect, 2)).toEqual({ kind: 'move', pane: 0 });
    expect(dropZone(450, rect, 2)).toEqual({ kind: 'move', pane: 0 });
    expect(dropZone(600, rect, 2)).toEqual({ kind: 'move', pane: 1 });
    // The divider itself belongs to the right pane, so there is no gap between them.
    expect(dropZone(500, rect, 2)).toEqual({ kind: 'move', pane: 1 });
  });

  it('says nothing for a pointer outside the area', () => {
    expect(dropZone(50, rect, 1)).toBeNull();
    expect(dropZone(950, rect, 2)).toBeNull();
  });

  it('says nothing for a rectangle with no width, which is what jsdom hands you', () => {
    // Guarded rather than left to divide by zero, because a component test that measured a
    // real element would otherwise get a confident answer from meaningless input.
    expect(dropZone(0, { left: 0, width: 0 }, 1)).toBeNull();
    // The two-pane case is the one that matters: without the guard the arithmetic gives NaN,
    // NaN < 0.5 is false, and it would answer "the right pane" with complete confidence.
    expect(dropZone(0, { left: 0, width: 0 }, 2)).toBeNull();
  });

  it('carries out what it described', () => {
    const layout = layoutOf('a.jff', 'b.jff');
    const target = dropZone(850, rect, 1)!;
    expect(names(tabsInPane(applyDrop(layout, key('b.jff'), target), 1))).toEqual(['b.jff']);
  });
});

describe('which pane a point is over', () => {
  const rect = { left: 100, width: 800 };

  it('is always the only one when there is only one', () => {
    expect(paneAtPoint(150, rect, 1)).toBe(0);
    expect(paneAtPoint(850, rect, 1)).toBe(0);
  });

  it('splits at the middle when there are two', () => {
    expect(paneAtPoint(450, rect, 2)).toBe(0);
    expect(paneAtPoint(600, rect, 2)).toBe(1);
  });

  it('says nothing outside the area, or for a rectangle with no width', () => {
    expect(paneAtPoint(50, rect, 2)).toBeNull();
    expect(paneAtPoint(950, rect, 2)).toBeNull();
    expect(paneAtPoint(0, { left: 0, width: 0 }, 2)).toBeNull();
  });
});

describe('the URL, which is what a refresh and a shared link restore', () => {
  const roundTrip = (layout: ViewerLayout) =>
    readLayout(new URLSearchParams(layoutToSearch(layout)));

  it('brings a split window back exactly', () => {
    const layout = splitTabToSide(layoutOf('a.jff', 'b.jff', 'c.jff'), key('c.jff'), 'right');
    const back = roundTrip(layout);
    expect(names(tabsInPane(back, 0))).toEqual(['a.jff', 'b.jff']);
    expect(names(tabsInPane(back, 1))).toEqual(['c.jff']);
    expect(back.focused).toBe(1);
    expect(activeTab(back, 1)?.file).toBe('c.jff');
  });

  it('brings a single pane back, and writes nothing about panes', () => {
    const layout = selectTab(layoutOf('a.jff', 'b.jff'), key('a.jff'));
    const search = layoutToSearch(layout);
    expect(search).not.toContain('panes=');
    expect(activeTab(roundTrip(layout), 0)?.file).toBe('a.jff');
  });

  it('still opens a link written before panes existed', () => {
    // These get bookmarked and pasted into mail. The tab list form, with one active index.
    const tabs = JSON.stringify([tab('a.jff'), tab('b.jff')]);
    const layout = readLayout(new URLSearchParams({ tabs, active: '1' }));
    expect(paneCount(layout)).toBe(1);
    expect(activeTab(layout, 0)?.file).toBe('b.jff');
  });

  it('still opens a link written before tabs existed', () => {
    const layout = readLayout(
      new URLSearchParams({ kind: 'submissions', file: 'a.jff', type: 'FA' }),
    );
    expect(names(layout.tabs)).toEqual(['a.jff']);
    expect(activeTab(layout, 0)?.file).toBe('a.jff');
  });

  it('ignores a pane list that does not match the tabs', () => {
    // Hand-edited, or truncated by whatever carried the link. One pane holding everything is
    // the safe reading: nothing is hidden, and the reader can split again.
    const tabs = JSON.stringify([tab('a.jff'), tab('b.jff')]);
    const layout = readLayout(new URLSearchParams({ tabs, panes: '011', active: '0,1' }));
    expect(paneCount(layout)).toBe(1);
    expect(names(tabsInPane(layout, 0))).toEqual(['a.jff', 'b.jff']);
  });

  it('ignores a pane list that is not a pane list', () => {
    const tabs = JSON.stringify([tab('a.jff'), tab('b.jff')]);
    const layout = readLayout(new URLSearchParams({ tabs, panes: 'xy' }));
    expect(paneCount(layout)).toBe(1);
  });

  it('opens nothing, rather than throwing, for a link that names no file', () => {
    expect(readLayout(new URLSearchParams()).tabs).toHaveLength(0);
  });

  it('puts a pane back on screen when the link says it is showing nothing', () => {
    const tabs = JSON.stringify([tab('a.jff'), tab('b.jff')]);
    const layout = readLayout(new URLSearchParams({ tabs, panes: '01', active: '-1,-1' }));
    expect(activeTab(layout, 0)?.file).toBe('a.jff');
    expect(activeTab(layout, 1)?.file).toBe('b.jff');
  });
});

describe('housekeeping the layout does for itself', () => {
  it('forgets the side a closed tab was on', () => {
    // Otherwise the record grows for the life of the window, and reopening a file would put
    // it back on a side the reader has no memory of choosing.
    const layout = closeTab(
      splitTabToSide(layoutOf('a.jff', 'b.jff'), key('b.jff'), 'right'),
      key('b.jff'),
    );
    expect(layout.panes).toEqual({ 'submissions:a.jff': 0 });
    expect(paneOf(layout, key('b.jff'))).toBe(0);
  });
});
