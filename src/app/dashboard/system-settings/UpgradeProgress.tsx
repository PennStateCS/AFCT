'use client';

import { deriveUpgradeSteps } from './system-settings-shared';
import { StepList } from './StepList';

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
  return <StepList steps={steps} ariaLabel="Update progress" />;
}
