'use client';

import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VIEWER_WINDOW_NAME } from '@/lib/viewer-link';
import {
  VIEWER_ALIVE_KEY,
  VIEWER_ALIVE_TIMEOUT_MS,
  VIEWER_CHANNEL,
  type ViewerTab,
} from '@/lib/viewer-tabs';

/** Whether a viewer window is open and listening, answered without waiting for a reply. */
function viewerIsOpen(): boolean {
  try {
    const beat = Number(window.localStorage.getItem(VIEWER_ALIVE_KEY));
    return Number.isFinite(beat) && Date.now() - beat < VIEWER_ALIVE_TIMEOUT_MS;
  } catch {
    // Blocked storage. Treat it as no window, which falls back to the older behaviour of
    // replacing whatever is in the named window.
    return false;
  }
}

/**
 * Sends the machine currently in a viewer dialog to the standalone window.
 *
 * A modal is right for a glance and wrong for a large automaton: it is capped by the viewport
 * it sits in, and the graph has to share that space with the page behind it.
 *
 * If a viewer window is already open, this asks it to add a tab rather than replacing what is
 * in it, so a reader can gather several students' work and move between them. That question
 * has to be answered synchronously, inside the click: a browser only allows `window.open` while
 * the gesture lasts, which rules out waiting for an answer over the channel. So the window
 * leaves a timestamp in `localStorage` and this reads it, the same trick and the same reason as
 * the shared idle clock in `SessionWatcher`.
 */
export function OpenInWindowButton({
  href,
  tab,
  onOpened,
}: {
  href: string;
  tab: ViewerTab;
  /**
   * Called once the file is on its way to the window.
   *
   * The dialogs use it to close themselves: the reader asked for this machine somewhere else,
   * so leaving the panel over the page they came from means dismissing it before they can use
   * it, and the two copies of the same file would be showing at once.
   */
  onOpened?: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => {
        const alreadyOpen = typeof BroadcastChannel === 'function' && viewerIsOpen();

        if (alreadyOpen) {
          const channel = new BroadcastChannel(VIEWER_CHANNEL);
          channel.postMessage({ type: 'open-tab', tab });
          channel.close();
          // An empty URL returns the existing window without navigating it, which is what
          // brings it forward without throwing away the tabs it already has.
          window.open('', VIEWER_WINDOW_NAME)?.focus();
          onOpened?.();
          return;
        }

        // Deliberately no `noopener`: it makes the browser treat the name as `_blank`, so the
        // window could never be found again and every file would get a window of its own. The
        // viewer is same-origin, so the handle it keeps is ours either way.
        window.open(href, VIEWER_WINDOW_NAME);
        onOpened?.();
      }}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      Open in the viewer
    </Button>
  );
}
