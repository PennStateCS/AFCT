'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type StepperProps = {
  /** Ordered step labels. */
  steps: readonly string[];
  /** 0-based index of the current step. */
  current: number;
  /**
   * Called when a completed step's marker is clicked (going back). Steps ahead
   * of the current one are never clickable — forward movement goes through the
   * flow's own Next control so validation can gate it.
   */
  onStepClick?: (index: number) => void;
  className?: string;
};

/**
 * A horizontal wizard step indicator: numbered circles joined by connector
 * lines, with completed steps showing a check. Purely presentational — the
 * parent owns the step state and validation.
 */
export function Stepper({ steps, current, onStepClick, className }: StepperProps) {
  return (
    <nav aria-label="Progress" className={className}>
      <ol className="flex items-center">
        {steps.map((label, index) => {
          const isDone = index < current;
          const isCurrent = index === current;
          const clickable = isDone && !!onStepClick;
          return (
            <li
              key={label}
              className={cn('flex items-center', index > 0 && 'min-w-0 flex-1')}
            >
              {index > 0 && (
                <div
                  aria-hidden="true"
                  className={cn(
                    'mx-2 h-px min-w-4 flex-1',
                    isDone || isCurrent ? 'bg-primary' : 'bg-border',
                  )}
                />
              )}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onStepClick?.(index)}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`Step ${index + 1}: ${label}${isDone ? ' (completed)' : ''}`}
                className={cn(
                  'flex shrink-0 items-center gap-1.5',
                  clickable ? 'cursor-pointer' : 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors',
                    isDone && 'border-primary bg-primary text-primary-foreground',
                    isCurrent && 'border-primary text-primary ring-primary/30 ring-2',
                    !isDone && !isCurrent && 'border-border text-muted-foreground',
                  )}
                >
                  {isDone ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : index + 1}
                </span>
                {/* On narrow screens only the current step keeps its label; the
                    rest collapse to numbered circles so five steps fit a phone.
                    (The button's aria-label always carries the full name.) */}
                <span
                  className={cn(
                    'text-xs font-medium whitespace-nowrap',
                    isCurrent
                      ? 'text-foreground'
                      : 'text-muted-foreground hidden sm:inline',
                    clickable && 'hover:text-foreground',
                  )}
                >
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
