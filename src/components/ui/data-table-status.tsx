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
export function DataTableLoading({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-2 text-gray-500', className)}
      role="status"
    >
      <span aria-hidden="true" className="text-brand-teal">
        <PulseLoader color="currentColor" size={8} margin={3} speedMultiplier={0.65} />
      </span>
      <span>{message}</span>
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
    <div className={cn('text-muted-foreground flex flex-col items-center', className)}>
      <Icon className="mb-2 h-10 w-10 text-gray-400" aria-hidden={true} />
      <p className="font-medium">{title}</p>
      <p className="text-sm">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
