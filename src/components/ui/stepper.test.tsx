/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { Stepper } from './stepper';

const STEPS = ['Basics', 'Schedule', 'People', 'Review'] as const;

describe('Stepper', () => {
  it('marks the current step and labels completed ones', () => {
    render(<Stepper steps={STEPS} current={2} />);

    expect(screen.getByRole('button', { name: 'Step 3: People' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByRole('button', { name: 'Step 1: Basics (completed)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Step 4: Review' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('only completed steps are clickable, and clicking one navigates back', async () => {
    const user = userEvent.setup();
    const onStepClick = vi.fn();
    render(<Stepper steps={STEPS} current={2} onStepClick={onStepClick} />);

    // A completed step navigates.
    await user.click(screen.getByRole('button', { name: 'Step 1: Basics (completed)' }));
    expect(onStepClick).toHaveBeenCalledWith(0);

    // The current and future steps are disabled — forward movement goes through Next.
    expect(screen.getByRole('button', { name: 'Step 3: People' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Step 4: Review' })).toBeDisabled();
  });
});
