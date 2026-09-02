import {
  MAX_VIEWER_TABS,
  readActiveIndex,
  readTabs,
  sameTab,
  tabKey,
  type ViewerTab,
} from '@/lib/viewer-tabs';

/**
 * Two machines side by side in the standalone viewer.
 *
 * The tab list stays flat and window-wide, exactly as it was before panes existed, and which
 * side a tab is on is kept beside it as an assignment rather than by nesting the tabs inside
 * pane objects. That is what keeps `withTab`, `withoutTab` and the tab cap working unchanged,
 * and it keeps one fact true that three other things depend on: a window never holds the same
 * file twice. The React key, the remembered-view key and the properties key are all the file,
 * so a second copy of one file in the other pane would collide in all three.
 *
 * Two panes is the cap. The ask was two machines side by side, and a third column of an
 * automaton is not readable on a screen anybody has.
 */

export type PaneIndex = 0 | 1;

export type ViewerLayout = {
  /** Every open file, in the order it was opened. Never reordered by a split. */
  tabs: ViewerTab[];
  /** Which side each tab is on, by key. A tab that is absent is on the left. */
  panes: Record<string, PaneIndex>;
  /** The tab showing in each pane, by key. Null when that pane holds nothing. */
  active: [string | null, string | null];
  /** The pane the menu bar acts on. */
  focused: PaneIndex;
};

/** Which side a tab is on. */
export const paneOf = (layout: ViewerLayout, key: string): PaneIndex => layout.panes[key] ?? 0;

/** The tabs on one side, in the window's own order. */
export const tabsInPane = (layout: ViewerLayout, pane: PaneIndex): ViewerTab[] =>
  layout.tabs.filter((tab) => paneOf(layout, tabKey(tab)) === pane);

/** One pane or two. Two only while the right-hand pane actually holds something. */
export const paneCount = (layout: ViewerLayout): 1 | 2 =>
  layout.tabs.some((tab) => paneOf(layout, tabKey(tab)) === 1) ? 2 : 1;

/** The tab showing in one pane. */
export function activeTab(layout: ViewerLayout, pane: PaneIndex): ViewerTab | null {
  const key = layout.active[pane];
  return layout.tabs.find((tab) => tabKey(tab) === key) ?? null;
}

/** The tab the menu bar acts on. */
export const focusedTab = (layout: ViewerLayout): ViewerTab | null =>
  activeTab(layout, layout.focused);

/** Whether a tab is the one on screen in its own pane. */
export const isShowing = (layout: ViewerLayout, tab: ViewerTab): boolean =>
  layout.active[paneOf(layout, tabKey(tab))] === tabKey(tab);

/** An empty window: no tabs, one pane. */
export const emptyLayout = (): ViewerLayout => ({
  tabs: [],
  panes: {},
  active: [null, null],
  focused: 0,
});

/**
 * Put a layout back into a state that makes sense.
 *
 * Called after every change rather than made each caller's problem: a pane that lost its last
 * tab has to disappear, whatever emptied it, and a pane whose active tab has gone has to show
 * something else. Doing it in one place is why the callers below are each a few lines.
 *
 * Exported because the page drops tabs of a type the viewer cannot draw, which is a change to
 * the tab list like any other and leaves the same loose ends behind.
 */
export function settleLayout(layout: ViewerLayout): ViewerLayout {
  const keys = new Set(layout.tabs.map(tabKey));

  // Drop assignments for tabs that have closed, so the record does not grow forever.
  const panes: Record<string, PaneIndex> = {};
  for (const [key, pane] of Object.entries(layout.panes)) {
    if (keys.has(key)) panes[key] = pane;
  }

  let next: ViewerLayout = { ...layout, panes };

  // A window with nothing on the left is a window with one pane, on the left.
  const left = tabsInPane(next, 0);
  const right = tabsInPane(next, 1);
  if (left.length === 0 && right.length > 0) {
    next = {
      ...next,
      panes: Object.fromEntries(Object.keys(next.panes).map((key) => [key, 0 as PaneIndex])),
      active: [next.active[1], null],
      focused: 0,
    };
  }

  // Each pane shows its first tab if what it was showing has gone or moved away.
  const active = ([0, 1] as const).map((pane) => {
    const inPane = tabsInPane(next, pane);
    const current = next.active[pane];
    if (current && inPane.some((tab) => tabKey(tab) === current)) return current;
    const first = inPane[0];
    return first ? tabKey(first) : null;
  }) as [string | null, string | null];

  // Focus cannot rest on a pane that is not there.
  const focused = tabsInPane(next, next.focused).length ? next.focused : 0;

  return { ...next, active, focused };
}

/** Show a tab, and focus the pane it is in. */
export function selectTab(layout: ViewerLayout, key: string): ViewerLayout {
  if (!layout.tabs.some((tab) => tabKey(tab) === key)) return layout;
  const pane = paneOf(layout, key);
  const active: [string | null, string | null] = [...layout.active];
  active[pane] = key;
  return settleLayout({ ...layout, active, focused: pane });
}

/** Focus a pane without changing which tab it shows. */
export const focusPane = (layout: ViewerLayout, pane: PaneIndex): ViewerLayout =>
  settleLayout({ ...layout, focused: pane });

/**
 * Add a tab, or select it if it is already open.
 *
 * Opening something twice must not produce two identical tabs: the reader would have no way to
 * tell them apart, and the two would share one remembered view.
 */
export function openTab(layout: ViewerLayout, next: ViewerTab): ViewerLayout {
  const existing = layout.tabs.find((tab) => sameTab(tab, next));
  if (existing) return selectTab(layout, tabKey(existing));

  let tabs = [...layout.tabs, next];
  let panes = { ...layout.panes, [tabKey(next)]: layout.focused };
  if (tabs.length > MAX_VIEWER_TABS) {
    // Full. Drop the oldest rather than refusing, which would look like the button broke.
    // `settle` handles the case where that was the last tab on one side.
    const evicted = tabs[0];
    tabs = tabs.slice(1);
    panes = { ...panes };
    if (evicted) delete panes[tabKey(evicted)];
  }

  const active: [string | null, string | null] = [...layout.active];
  active[layout.focused] = tabKey(next);
  return settleLayout({ ...layout, tabs, panes, active });
}

/** Close a tab. A pane left with nothing closes with it. */
export function closeTab(layout: ViewerLayout, key: string): ViewerLayout {
  if (!layout.tabs.some((tab) => tabKey(tab) === key)) return layout;
  return settleLayout({ ...layout, tabs: layout.tabs.filter((tab) => tabKey(tab) !== key) });
}

/**
 * Split a tab out to one side, making the second pane.
 *
 * The side is where the dragged tab lands, so dropping on the left puts it on the left and
 * everything else on the right. Refused for the only open tab: splitting it would leave one
 * pane holding nothing, which is a window with one pane and a wasted half of the screen.
 */
export function splitTabToSide(
  layout: ViewerLayout,
  key: string,
  side: 'left' | 'right',
): ViewerLayout {
  if (layout.tabs.length < 2) return layout;
  if (!layout.tabs.some((tab) => tabKey(tab) === key)) return layout;

  const dragged: PaneIndex = side === 'left' ? 0 : 1;
  const rest: PaneIndex = side === 'left' ? 1 : 0;
  const panes = Object.fromEntries(
    layout.tabs.map((tab) => [tabKey(tab), tabKey(tab) === key ? dragged : rest]),
  ) as Record<string, PaneIndex>;

  const active: [string | null, string | null] = [null, null];
  active[dragged] = key;
  return settleLayout({ ...layout, panes, active, focused: dragged });
}

/**
 * Move a tab to the other side, when both sides already exist.
 *
 * Moving the last tab out of a pane is allowed here, unlike a split: it collapses the window
 * back to one pane, which is how somebody undoes a split.
 */
export function moveTabToPane(layout: ViewerLayout, key: string, pane: PaneIndex): ViewerLayout {
  if (!layout.tabs.some((tab) => tabKey(tab) === key)) return layout;
  if (paneOf(layout, key) === pane) return focusPane(layout, pane);

  const active: [string | null, string | null] = [...layout.active];
  active[pane] = key;
  return settleLayout({
    ...layout,
    panes: { ...layout.panes, [key]: pane },
    active,
    focused: pane,
  });
}

/**
 * Put a tab in a pane, at a place in that pane's strip.
 *
 * `before` is the tab it should sit in front of, or null for the end of that strip. The window
 * keeps one list across both panes and `tabsInPane` filters it, so moving within the global
 * list is all the per-pane order needs.
 */
export function moveTabBefore(
  layout: ViewerLayout,
  key: string,
  before: string | null,
  pane: PaneIndex,
): ViewerLayout {
  const moving = layout.tabs.find((tab) => tabKey(tab) === key);
  if (!moving || key === before) return layout;

  const rest = layout.tabs.filter((tab) => tabKey(tab) !== key);
  let at: number;
  if (before) {
    at = rest.findIndex((tab) => tabKey(tab) === before);
    if (at < 0) return layout;
  } else {
    // The end of that pane's own tabs, which is not the end of the list when the other pane's
    // tabs come after them.
    const last = rest.reduce(
      (found, tab, i) => (paneOf(layout, tabKey(tab)) === pane ? i : found),
      -1,
    );
    at = last + 1;
  }

  const tabs = [...rest.slice(0, at), moving, ...rest.slice(at)];
  const active: [string | null, string | null] = [...layout.active];
  active[pane] = key;
  return settleLayout({
    ...layout,
    tabs,
    panes: { ...layout.panes, [key]: pane },
    active,
    focused: pane,
  });
}

/**
 * Which gap in a strip a pointer is over, given where each tab is.
 *
 * The count of tabs whose middle is left of the pointer, which is the index a drop would
 * insert at. Null when nothing can be measured: jsdom reports every element as zero-sized, and
 * an answer derived from that would be arithmetic rather than a place on screen.
 */
export function insertionIndexAt(
  clientX: number,
  rects: readonly { left: number; width: number }[],
): number | null {
  if (rects.length === 0) return 0;
  if (!Number.isFinite(clientX) || !rects.some((rect) => rect.width > 0)) return null;
  return rects.filter((rect) => rect.left + rect.width / 2 < clientX).length;
}

/* ── where a dragged tab would land ─────────────────────────────────────── */

/** What a drop at a given place would do. */
export type DropTarget =
  { kind: 'split'; side: 'left' | 'right' } | { kind: 'move'; pane: PaneIndex };

/**
 * How much of each edge offers a split, as a fraction of the width.
 *
 * A quarter: wide enough to hit without aiming, narrow enough that dragging a tab across the
 * middle of a single machine does not keep suggesting a split nobody asked for.
 */
export const SPLIT_EDGE_FRACTION = 0.25;

/**
 * Where a pointer at `clientX` would drop a tab, or null for nowhere.
 *
 * Pure, and separate from any event, because this is the part with the arithmetic in it and
 * jsdom cannot give a test a real rectangle to measure against.
 *
 * With one pane only the two edges do anything, since the drop has to say which side the new
 * pane goes on. With two panes the whole half is a target: the panes are already there, so a
 * drop anywhere in one means that one, and there is no third thing it could mean.
 */
/**
 * Which pane a point is over, or null when it is outside or the rectangle is meaningless.
 *
 * Separate from `dropZone` because it answers a question a click asks as well as a drag: a
 * pointer down in one pane focuses it, which is how the menu bar knows which machine to act
 * on. jsdom hands out zero-sized rectangles, so a width of nothing has to mean "no answer"
 * rather than an arithmetic accident: `NaN < 0.5` is false, and the right pane would be
 * returned with complete confidence.
 */
export function paneAtPoint(
  clientX: number,
  rect: { left: number; width: number },
  panes: 1 | 2,
): PaneIndex | null {
  if (!(rect.width > 0) || !Number.isFinite(clientX)) return null;
  const x = (clientX - rect.left) / rect.width;
  if (x < 0 || x > 1) return null;
  if (panes === 1) return 0;
  // The divider itself belongs to the right pane, so there is no gap between them.
  return x < 0.5 ? 0 : 1;
}

export function dropZone(
  clientX: number,
  rect: { left: number; width: number },
  panes: 1 | 2,
): DropTarget | null {
  const pane = paneAtPoint(clientX, rect, panes);
  if (pane === null) return null;
  if (panes === 2) return { kind: 'move', pane };

  const x = (clientX - rect.left) / rect.width;
  if (x <= SPLIT_EDGE_FRACTION) return { kind: 'split', side: 'left' };
  if (x >= 1 - SPLIT_EDGE_FRACTION) return { kind: 'split', side: 'right' };
  return null;
}

/** Carry out a drop. Returns the layout unchanged when the drop would do nothing. */
export function applyDrop(layout: ViewerLayout, key: string, target: DropTarget): ViewerLayout {
  return target.kind === 'split'
    ? splitTabToSide(layout, key, target.side)
    : moveTabToPane(layout, key, target.pane);
}

/* ── the URL, which is what a refresh and a shared link restore ─────────── */

/**
 * Read a layout out of a URL.
 *
 * Layered so every older form of the link still opens: the pane fields on top of the tab list,
 * the tab list on top of the single-file parameters that predate tabs entirely.
 */
export function readLayout(params: URLSearchParams): ViewerLayout {
  const tabs = readTabs(params);
  if (tabs.length === 0) return emptyLayout();

  // One digit per tab, in the same order. A length that does not match means the two were
  // edited apart, and one pane holding everything is the safe reading of that.
  const raw = params.get('panes') ?? '';
  const panes: Record<string, PaneIndex> = {};
  if (raw.length === tabs.length && /^[01]*$/.test(raw)) {
    tabs.forEach((tab, i) => {
      panes[tabKey(tab)] = raw[i] === '1' ? 1 : 0;
    });
  }

  const indexOf = (value: string | undefined): string | null => {
    const n = Number(value);
    const tab = Number.isInteger(n) && n >= 0 ? tabs[n] : undefined;
    return tab ? tabKey(tab) : null;
  };
  const activeParam = params.get('active') ?? '';
  const [left, right] = activeParam.includes(',')
    ? activeParam.split(',')
    : // The older single-number form, which named the one active tab.
      [String(readActiveIndex(params, tabs.length)), undefined];

  const focusRaw = Number(params.get('focus') ?? '0');
  const focused: PaneIndex = focusRaw === 1 ? 1 : 0;

  return settleLayout({
    tabs,
    panes,
    active: [indexOf(left), indexOf(right)],
    focused,
  });
}

/** The query string for a layout, for `history.replaceState`. */
export function layoutToSearch(layout: ViewerLayout): string {
  const params = new URLSearchParams();
  params.set('tabs', JSON.stringify(layout.tabs));
  const indexOf = (key: string | null) =>
    key === null ? -1 : layout.tabs.findIndex((tab) => tabKey(tab) === key);
  params.set('active', `${indexOf(layout.active[0])},${indexOf(layout.active[1])}`);
  if (paneCount(layout) === 2) {
    params.set('panes', layout.tabs.map((tab) => paneOf(layout, tabKey(tab))).join(''));
    params.set('focus', String(layout.focused));
  }
  return params.toString();
}
