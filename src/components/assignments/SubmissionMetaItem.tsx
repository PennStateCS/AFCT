'use client';

import type React from 'react';
import { cn } from '@/lib/utils';

/**
 * One reading in the submission header's status row: a quiet label over its value.
 *
 * Four of these sit in a grid under the two pickers. They are deliberately plain, because
 * the pickers are what a grader operates and these are what they glance at.
 */
export function SubmissionMetaItem({
  label,
  children,
  emphasis = false,
  className,
}: {
  label: string;
  children: React.ReactNode;
  /** The score, which is the one figure worth finding without reading the labels. */
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div
        className={cn(
          'text-sm break-words',
          emphasis && 'text-base leading-tight font-semibold tabular-nums',
        )}
      >
        {children}
      </div>
    </div>
  );
}

export default SubmissionMetaItem;
