'use client';

import { Stepper } from '@/components/ui/stepper';

type Props = {
  steps: readonly string[];
  current: number;
  onStepClick?: (index: number) => void;
  className?: string;
};

/**
 * The step indicator shared by the multi-step dialog wizards: the visual {@link Stepper}
 * plus an sr-only live region that announces the current step to assistive tech.
 */
export function WizardSteps({ steps, current, onStepClick, className }: Props) {
  return (
    <>
      <Stepper
        steps={steps as unknown as string[]}
        current={current}
        onStepClick={onStepClick}
        className={className}
      />
      <div className="sr-only" role="status" aria-live="polite">
        {`Step ${current + 1} of ${steps.length}: ${steps[current]}`}
      </div>
    </>
  );
}
