'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ViewerActionsProvider } from '@/components/viewer/viewer-actions';
import { ViewerMenubar } from '@/components/viewer/ViewerMenubar';
import { viewerFileSrc } from '@/lib/viewer-link';
import type { ViewerProperties } from '@/lib/viewer-properties';
import {
  tabsToSearch,
  withTab,
  withoutTab,
  VIEWER_ALIVE_KEY,
  VIEWER_CHANNEL,
  type ViewerTab,
} from '@/lib/viewer-tabs';
import { ViewerClient } from './ViewerClient';

/** How often the window says it is alive, so an opener can find it without a handle. */
const HEARTBEAT_MS = 2000;

/**
 * The standalone viewer window: a strip of open files, one of them showing.
 *
 * The tab list is state here and mirrored into the URL with `history.replaceState`, never a
 * router navigation. This route is a server component, so navigating would re-run its queries
 * on every tab click for data already in hand. The same reason `useReviewSelection` does it.
 *
 * Only the active tab renders a viewer. That is what keeps the audit trail honest: the bytes
 * of a student's file are fetched when somebody looks at it, so ten open tabs and a refresh do
 * not write eleven disclosure records for work nobody read.
 */
export function ViewerWindow({
  initialTabs,
  initialActive,
  initialProperties,
}: {
  initialTabs: ViewerTab[];
  initialActive: number;
  /** Properties for the tabs the window opened with, loaded on the server. */
  initialProperties: Record<string, ViewerProperties | null>;
}) {
  const [tabs, setTabs] = useState(initialTabs);
  const [activeIndex, setActiveIndex] = useState(initialActive);
  const [properties, setProperties] =
    useState<Record<string, ViewerProperties | null>>(initialProperties);

  const active = tabs[activeIndex];
  const keyOf = (tab: ViewerTab) => `${tab.kind}:${tab.file}`;

  // The URL follows the tabs, so a refresh restores this set and the link can be handed on.
  useEffect(() => {
    if (tabs.length === 0) return;
    window.history.replaceState(null, '', `?${tabsToSearch(tabs, activeIndex)}`);
  }, [tabs, activeIndex]);

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

  const openTab = useCallback((next: ViewerTab) => {
    setTabs((current) => {
      const result = withTab(current, next);
      setActiveIndex(result.activeIndex);
      return result.tabs;
    });
  }, []);

  // Another window asking for a file to be opened here rather than in a window of its own.
  useEffect(() => {
    if (typeof BroadcastChannel !== 'function') return;
    const channel = new BroadcastChannel(VIEWER_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; tab?: ViewerTab } | null;
      if (message?.type !== 'open-tab' || !message.tab) return;
      openTab(message.tab);
      // Bring the window forward, since the click that asked for this happened elsewhere.
      window.focus();
    };
    return () => channel.close();
  }, [openTab]);

  // Properties for a tab that arrived after the page was rendered, which the server never saw.
  useEffect(() => {
    if (!active) return;
    const key = keyOf(active);
    if (key in properties) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/viewer/properties?kind=${encodeURIComponent(active.kind)}&file=${encodeURIComponent(active.file)}`,
        );
        const value = res.ok ? ((await res.json()) as ViewerProperties) : null;
        if (!cancelled) setProperties((p) => ({ ...p, [key]: value }));
      } catch {
        if (!cancelled) setProperties((p) => ({ ...p, [key]: null }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, properties]);

  if (!active) {
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
          downloadHref={`${viewerFileSrc(active.kind, active.file)}?download=1`}
          properties={properties[keyOf(active)] ?? null}
        />

        {/* The strip. Tabs carry the white of the menu bar above and the grey of the toolbar
            below, so the selected one reads as the label of what is on screen. */}
        <div
          className="bg-card flex shrink-0 items-end gap-1 overflow-x-auto px-3 pt-2"
          role="tablist"
        >
          {tabs.map((tab, index) => {
            const selected = index === activeIndex;
            return (
              <div
                key={keyOf(tab)}
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
                  onClick={() => setActiveIndex(index)}
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
                  onClick={() => {
                    const result = withoutTab(tabs, index, activeIndex);
                    setTabs(result.tabs);
                    setActiveIndex(result.activeIndex);
                  }}
                  aria-label={`Close ${tab.name}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
        </div>

        <div className="min-h-0 flex-1">
          {/* Keyed on the file, so switching tabs builds a fresh graph rather than reusing one
              machine's engine for another's states. */}
          <ViewerClient
            key={keyOf(active)}
            src={viewerFileSrc(active.kind, active.file)}
            problemType={active.type}
            title={active.title}
            epsSymbol={active.eps}
          />
        </div>
      </main>
    </ViewerActionsProvider>
  );
}
