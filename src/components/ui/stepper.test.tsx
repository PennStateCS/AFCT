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

    // The current and future steps are disabled; forward movement goes through Next.
    expect(screen.getByRole('button', { name: 'Step 3: People' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Step 4: Review' })).toBeDisabled();
  });
});

/**
 * Reported by a student on a phone: the connector rule ran through the current step's label,
 * and a longer one ("Faculty & TAs") carried on over the next step's number. The cause was a
 * button that could not shrink holding text that could not wrap, so it overflowed its own box
 * and everything after it drew on top.
 */
describe('a long step name on a narrow screen', () => {
  it('lets the label give way rather than the layout', () => {
    render(<Stepper steps={['Details', 'Faculty & TAs', 'Review']} current={1} />);

    const label = screen.getAllByText('Faculty & TAs').find((el) => el.tagName === 'SPAN')!;
    // Truncation is what keeps the text inside its own box on a narrow dialog.
    expect(label.className).toContain('truncate');
    // And the box it is in has to be allowed to shrink, or truncation never engages.
    expect(label.closest('button')?.className).toContain('min-w-0');
    expect(label.closest('button')?.className).not.toContain('shrink-0');
  });

  it('names the current step on a line of its own, for screens that cannot carry it inline', () => {
    // Five names never fit a phone, and cutting the current one to "Facult…" is not an
    // answer. Below `sm` the row is numbers only and this line says where you are.
    render(<Stepper steps={['Details', 'Faculty & TAs', 'Review']} current={1} />);

    const caption = screen.getAllByText('Faculty & TAs').find((el) => el.tagName === 'P')!;
    expect(caption.className).toContain('sm:hidden');
    // Centred, or it sits under the first circle and reads as that step's label.
    expect(caption.className).toContain('text-center');
    // Said twice to a screen reader otherwise: the step buttons carry the name already.
    expect(caption).toHaveAttribute('aria-hidden', 'true');
    // And the inline copy is the one that hides on a phone.
    const inline = screen.getAllByText('Faculty & TAs').find((el) => el.tagName === 'SPAN')!;
    expect(inline.className).toContain('hidden');
    expect(inline.className).toContain('sm:inline');
  });

  it('keeps the step circle its full size, since only the text may give', () => {
    render(<Stepper steps={['Details', 'Faculty & TAs', 'Review']} current={1} />);

    const circle = screen.getByText('2');
    expect(circle.className).toContain('shrink-0');
  });
});
