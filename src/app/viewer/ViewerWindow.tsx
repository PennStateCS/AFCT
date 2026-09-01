'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ViewerActionsGate, ViewerActionsProvider } from '@/components/viewer/viewer-actions';
import { ViewerMenubar } from '@/components/viewer/ViewerMenubar';
import { viewerFileSrc } from '@/lib/viewer-link';
import type { ViewerProperties } from '@/lib/viewer-properties';
import { clearViewState } from '@/lib/viewer-view-state';
import { tabKey, VIEWER_ALIVE_KEY, VIEWER_CHANNEL, type ViewerTab } from '@/lib/viewer-tabs';
import {
  activeTab,
  closeTab,
  focusedTab,
  isShowing,
  layoutToSearch,
  openTab,
  paneCount,
  paneOf,
  selectTab,
  tabsInPane,
  type PaneIndex,
  type ViewerLayout,
} from '@/lib/viewer-panes';
import { ViewerClient } from './ViewerClient';

/** How often the window says it is alive, so an opener can find it without a handle. */
const HEARTBEAT_MS = 2000;

/** What each pane is called, for the tab strips and anything that names a side. */
const PANE_NAMES = ['Left pane', 'Right pane'] as const;

/**
 * Where a pane sits in the shared body.
 *
 * Absolute rather than a flex row because every viewer in the window is a sibling in one
 * container: see the body below for why that matters. A pane is a rectangle, not a box with
 * its own children.
 */
function paneRectClass(pane: PaneIndex, panes: 1 | 2): string {
  if (panes === 1) return 'inset-0';
  return pane === 0 ? 'inset-y-0 left-0 w-1/2' : 'inset-y-0 left-1/2 w-1/2';
}

/**
 * The standalone viewer window: strips of open files, one file showing per pane.
 *
 * The layout is state here and mirrored into the URL with `history.replaceState`, never a
 * router navigation. This route is a server component, so navigating would re-run its queries
 * on every tab click for data already in hand. The same reason `useReviewSelection` does it.
 *
 * Only a tab that has been looked at renders a viewer. That is what keeps the audit trail
 * honest: the bytes of a student's file are fetched when somebody looks at it, so ten open
 * tabs and a refresh do not write eleven disclosure records for work nobody read.
 */
export function ViewerWindow({
  initialLayout,
  initialProperties,
}: {
  initialLayout: ViewerLayout;
  /** Properties for the tabs the window opened with, loaded on the server. */
  initialProperties: Record<string, ViewerProperties | null>;
}) {
  const [layout, setLayout] = useState(initialLayout);
  const [properties, setProperties] =
    useState<Record<string, ViewerProperties | null>>(initialProperties);
  /**
   * Which tabs have been looked at, and so are kept mounted.
   *
   * A tab that has been on screen stays in the tree, hidden, because unmounting it would take
   * its zoom, its arrangement and its undo history with it: switching away and back would
   * silently undo the reader's work on that machine. One that has never been opened is not
   * mounted at all, which is what keeps a window full of tabs from fetching a dozen students'
   * files, and the audit trail from recording a dozen views nobody made.
   */
  const [opened, setOpened] = useState<string[]>([]);

  const panes = paneCount(layout);
  const focused = focusedTab(layout);
  // Both panes' tabs are on screen at once when the window is split, so both count as looked
  // at and both need their properties, not just whichever pane the menu bar is driving.
  const showing = useMemo(
    () => [activeTab(layout, 0), activeTab(layout, 1)].filter((tab) => tab !== null),
    [layout],
  );
  const showingKeys = showing.map(tabKey).join('|');

  useEffect(() => {
    if (!showingKeys) return;
    const keys = showingKeys.split('|');
    setOpened((current) => {
      const missing = keys.filter((key) => !current.includes(key));
      return missing.length ? [...current, ...missing] : current;
    });
  }, [showingKeys]);

  // The URL follows the layout, so a refresh restores this set and the link can be handed on.
  useEffect(() => {
    if (layout.tabs.length === 0) return;
    window.history.replaceState(null, '', `?${layoutToSearch(layout)}`);
  }, [layout]);

  /**
   * Say the window is here.
   *
   * `localStorage` rather than the channel, for the reason `SessionWatcher` gives: an opener
   * has to answer "is a viewer already open" synchronously inside the click, before the
   * browser withdraws the gesture that lets it open a window at all. A message cannot be
   * waited for in that window of time; a stored timestamp can be read.
   */
  useEffect(() => {
    const beat = () => {
      try {
        window.localStorage.setItem(VIEWER_ALIVE_KEY, String(Date.now()));
      } catch {
        // Private browsing or blocked storage. The opener then just replaces this window,
        // which is the behaviour from before tabs existed.
      }
    };
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    const clear = () => {
      try {
        window.localStorage.removeItem(VIEWER_ALIVE_KEY);
      } catch {
        /* nothing to clear */
      }
    };
    window.addEventListener('pagehide', clear);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', clear);
      clear();
    };
  }, []);

  // A file sent from another window lands in the pane the menu bar is on, which is the one
  // the reader was last working in.
  const receiveTab = useCallback((next: ViewerTab) => {
    setLayout((current) => openTab(current, next));
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'function') return;
    const channel = new BroadcastChannel(VIEWER_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; tab?: ViewerTab } | null;
      if (message?.type !== 'open-tab' || !message.tab) return;
      receiveTab(message.tab);
      // Bring the window forward, since the click that asked for this happened elsewhere.
      window.focus();
    };
    return () => channel.close();
  }, [receiveTab]);

  // Properties for a tab that arrived after the page was rendered, which the server never saw.
  useEffect(() => {
    const wanted = showing.filter((tab) => !(tabKey(tab) in properties));
    if (wanted.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const tab of wanted) {
        try {
          const res = await fetch(
            `/api/viewer/properties?kind=${encodeURIComponent(tab.kind)}&file=${encodeURIComponent(tab.file)}`,
          );
          const value = res.ok ? ((await res.json()) as ViewerProperties) : null;
          if (!cancelled) setProperties((p) => ({ ...p, [tabKey(tab)]: value }));
        } catch {
          if (!cancelled) setProperties((p) => ({ ...p, [tabKey(tab)]: null }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showing, properties]);

  const close = (tab: ViewerTab) => {
    const key = tabKey(tab);
    setLayout((current) => closeTab(current, key));
    // Closing already unmounts it, since it leaves the tab list. This just keeps the list
    // from accumulating files nobody has open any more.
    setOpened((current) => current.filter((k) => k !== key));
    // Closing is how a reader discards an arrangement, so the remembered view goes with it
    // rather than reappearing if they open the file again.
    clearViewState(key);
  };

  if (!focused) {
    return (
      <main className="flex h-screen min-w-0 flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground text-sm">
          No file is open. Choose one from a course and select Open in the viewer.
        </p>
      </main>
    );
  }

  return (
    <ViewerActionsProvider>
      <main className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <ViewerMenubar
          downloadHref={`${viewerFileSrc(focused.kind, focused.file)}?download=1`}
          properties={properties[tabKey(focused)] ?? null}
        />

        {/* One strip per pane, side by side. Tabs carry the white of the menu bar above and
            the grey of the toolbar below, so the selected one reads as the label of what is
            on screen. */}
        <div className="bg-card flex shrink-0">
          {(panes === 1 ? ([0] as const) : ([0, 1] as const)).map((pane) => (
            <div
              key={pane}
              className={cn(
                'flex min-w-0 items-end gap-1 overflow-x-auto px-3 pt-2',
                panes === 1 ? 'flex-1' : 'w-1/2',
              )}
              role="tablist"
              aria-label={panes === 1 ? 'Open files' : PANE_NAMES[pane]}
            >
              {tabsInPane(layout, pane).map((tab) => {
                const selected = isShowing(layout, tab);
                return (
                  <div
                    key={tabKey(tab)}
                    className={cn(
                      'flex max-w-56 shrink-0 items-center gap-1 rounded-t-md border pr-1',
                      selected
                        ? 'bg-background border-b-0'
                        : 'bg-card text-muted-foreground hover:bg-muted border-transparent',
                    )}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setLayout((current) => selectTab(current, tabKey(tab)))}
                      className="min-w-0 truncate px-3 py-1.5 text-sm font-semibold"
                      title={tab.title}
                    >
                      {tab.name}
                    </button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 shrink-0 p-0"
                      onClick={() => close(tab)}
                      aria-label={`Close ${tab.name}`}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/*
          One body holding every opened tab, not one body per pane.

          Two rules keep a machine's zoom, arrangement and undo history alive when it is moved
          from one side to the other. Every viewer is a direct sibling of every other, so no
          per-pane wrapper: a component that crosses parents is unmounted and rebuilt. And they
          are rendered in the window's own tab order, never grouped by pane, so a move changes
          nothing but a class and does not reorder the DOM, which would drop focus out of the
          graph a reader was using.

          Hidden with `visibility` rather than `display`, because a hidden box keeps its size:
          cytoscape reads the container to work out its viewport, and a collapsed one would
          come back at the wrong scale, which is the very thing this is preserving.
        */}
        <div className="relative min-h-0 flex-1">
          {layout.tabs
            .filter((tab) => opened.includes(tabKey(tab)) || isShowing(layout, tab))
            .map((tab) => {
              const pane = paneOf(layout, tabKey(tab));
              const visible = isShowing(layout, tab);
              return (
                <div
                  key={tabKey(tab)}
                  className={cn('absolute', paneRectClass(pane, panes), !visible && 'invisible')}
                  // Out of the accessibility tree and out of the tab order while hidden, so a
                  // reader is not walked through a dozen machines they cannot see.
                  inert={!visible}
                >
                  {/* Only the pane the menu bar is on may publish its actions to it. */}
                  <ViewerActionsGate active={visible && pane === layout.focused}>
                    <ViewerClient
                      src={viewerFileSrc(tab.kind, tab.file)}
                      problemType={tab.type}
                      title={tab.title}
                      epsSymbol={tab.eps}
                      viewStateKey={tabKey(tab)}
                    />
                  </ViewerActionsGate>
                </div>
              );
            })}
        </div>
      </main>
    </ViewerActionsProvider>
  );
}
