'use client';

import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { deriveUpgradeSteps } from './system-settings-shared';

/**
 * A small ordered checklist showing where an in-flight upgrade/downgrade is, derived
 * from the updater's current phase. Renders nothing for phases that don't map to a
 * step list (failed / rolled_back), where the status badge tells the story instead.
 */
export function UpgradeProgress({
  phase,
  action,
}: {
  phase: string | undefined | null;
  action?: 'upgrade' | 'downgrade';
}) {
  const steps = deriveUpgradeSteps(phase, action);
  if (!steps) return null;

  return (
    <ol className="space-y-1.5" aria-label="Update progress">
      {steps.map((step) => (
        <li key={step.label} className="flex items-center gap-2 text-sm">
          {step.state === 'done' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
          ) : step.state === 'current' ? (
            <Loader2 className="text-secondary h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <Circle className="text-muted-foreground/40 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span
            className={
              step.state === 'pending'
                ? 'text-muted-foreground'
                : step.state === 'current'
                  ? 'font-medium'
                  : ''
            }
          >
            {step.label}
          </span>
          <span className="sr-only">
            {step.state === 'done'
              ? ' (done)'
              : step.state === 'current'
                ? ' (in progress)'
                : ' (pending)'}
          </span>
        </li>
      ))}
    </ol>
  );
}
