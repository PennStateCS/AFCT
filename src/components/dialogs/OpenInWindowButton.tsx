'use client';

import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VIEWER_WINDOW_NAME } from '@/lib/viewer-link';

/**
 * Sends the machine currently in a viewer dialog to its own browser window.
 *
 * A modal is right for a glance and wrong for a large automaton: it is capped by the
 * viewport it sits in, and the graph has to share that space with the page behind it. The
 * separate window is the same viewer with the whole screen, which is what makes a big
 * machine readable and what lets it sit on a second monitor.
 *
 * The window is named, so clicking again focuses the one already open rather than
 * scattering windows. The other half of that: opening a *different* machine reuses the
 * same window, so this is one pop-out showing the latest thing asked for, not a way to get
 * two machines side by side. That comes later.
 */
export function OpenInWindowButton({ href }: { href: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => {
        // `noopener` keeps the new window from holding a handle back to this one. It is
        // same-origin, so this is hygiene rather than a fix, but it is the default the
        // rest of the app already uses for window.open.
        window.open(href, VIEWER_WINDOW_NAME, 'noopener,noreferrer');
      }}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      Open in a new window
    </Button>
  );
}
