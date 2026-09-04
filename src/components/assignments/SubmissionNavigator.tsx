'use client';

import type React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The shell both pickers in the submission header share: a label carrying the position, a
 * back button, whatever dropdown the caller supplies, and a forward button.
 *
 * The two used to be separate copies of the same arrangement, which is how they drifted
 * apart (one put its position inside the trigger, one to the right of it). The dropdown
 * itself stays with the caller: the student list searches and the problem list does not,
 * and that is a real difference. This owns the frame, not the menu.
 *
 * The position sits WITH the label ("Student · 1 of 17") rather than inside the control,
 * where it was nowrap and took 50px off a name that was already truncating.
 */
export function SubmissionNavigator({
  label,
  position,
  total,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  prevTitle,
  nextTitle,
  keyShortcuts,
  disabled = false,
  children,
  className,
}: {
  label: string;
  /** 1-based position of the current item. Omitted while nothing is selected. */
  position?: number | null;
  total?: number;
  onPrev: () => void;
  onNext: () => void;
  /** Accessible names, e.g. "Previous student". These are the only name these buttons have. */
  prevLabel: string;
  nextLabel: string;
  prevTitle?: string;
  nextTitle?: string;
  /** e.g. ['ArrowLeft', 'ArrowRight'] where the page binds them. */
  keyShortcuts?: [string, string];
  disabled?: boolean;
  /** The dropdown. Its trigger should be `min-w-0 flex-1 rounded-none border-x-0`. */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {/* The noun carries the weight and the count stays quiet: they are one line, but only
          one of them is what you are looking for. 13px, because at 12 the label read as a
          caption under the control rather than as its name. */}
      <span className="text-[13px] leading-none">
        <span className="text-foreground font-medium">{label}</span>
        {typeof position === 'number' && typeof total === 'number' ? (
          <span className="text-muted-foreground tabular-nums">
            {' · '}
            {position} of {total}
          </span>
        ) : null}
      </span>
      {/* One segmented control: the arrows are square ends on the same box as the trigger, so
          the three read as one thing to operate rather than three neighbours. The trigger
          between them takes all the room the arrows leave. */}
      <div className="flex w-full min-w-0 items-center">
        <Button
          variant="secondary"
          size="icon"
          onClick={onPrev}
          aria-keyshortcuts={keyShortcuts?.[0]}
          aria-label={prevLabel}
          title={prevTitle ?? prevLabel}
          className="shrink-0 rounded-r-none"
          disabled={disabled}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        {children}
        <Button
          variant="secondary"
          size="icon"
          onClick={onNext}
          aria-keyshortcuts={keyShortcuts?.[1]}
          aria-label={nextLabel}
          title={nextTitle ?? nextLabel}
          className="shrink-0 rounded-l-none"
          disabled={disabled}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export default SubmissionNavigator;
