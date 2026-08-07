'use client';

import type { ComponentType, ReactNode } from 'react';
import { PulseLoader } from 'react-spinners';
import { cn } from '@/lib/utils';

/**
 * The loading and empty states shared by the desktop table and the mobile card
 * stack. Both views used to carry their own copy of this markup, which meant every
 * spinner or empty-state tweak had to be made twice and stayed in sync only by
 * hand. The caller supplies the wrapper (a table cell vs a bordered card), these
 * render the contents.
 */

/** Spinner + status text. Its own live region, so the message is announced. */
export function DataTableLoading({ message, className }: { message: string; className?: string }) {
  return (
    <div
      className={cn(
        'text-muted-foreground flex flex-col items-center justify-center gap-2',
        className,
      )}
      role="status"
    >
      <span aria-hidden="true" className="text-brand-teal">
        <PulseLoader color="currentColor" size={8} margin={3} speedMultiplier={0.65} />
      </span>
      {/* Centered for the same reason as the empty state's description: on a narrow
          screen the message wraps, and left-aligned lines under a centered spinner
          read as a misalignment. */}
      <span className="px-4 text-center">{message}</span>
    </div>
  );
}

/** Icon, headline, explanation, and an optional call to action. */
export function DataTableEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    // role="status" so a filter/search that narrows the rows to zero announces the
    // empty message instead of leaving the table silently blank. (Live regions do not
    // announce their initial content, so this stays quiet on a first-load empty table.)
    <div
      className={cn('text-muted-foreground flex flex-col items-center', className)}
      role="status"
    >
      <Icon className="text-muted-foreground mb-2 h-10 w-10" aria-hidden={true} />
      <p className="text-center font-medium">{title}</p>
      {/* Centered text, not just a centered block: on a phone the description wraps over
          several lines, and left-aligned text under a centered icon and title read as a
          misalignment. max-w keeps it from running edge to edge on a wide screen. */}
      <p className="max-w-prose px-4 text-center text-sm">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
