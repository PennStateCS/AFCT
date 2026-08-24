/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { LimitField } from './LimitField';

describe('LimitField', () => {
  it('hides the number input when Unlimited is selected and shows it when Limited', async () => {
    const user = userEvent.setup();
    const onUnlimitedChange = vi.fn();

    const { rerender } = render(
      <LimitField
        label="Max States"
        name="maxStates"
        unlimited
        onUnlimitedChange={onUnlimitedChange}
        value=""
        onValueChange={vi.fn()}
      />,
    );

    // Unlimited: no number box.
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

    // Choosing "Limited" reports the change up.
    await user.click(screen.getByRole('radio', { name: 'Limited' }));
    expect(onUnlimitedChange).toHaveBeenCalledWith(false);

    // When the parent flips the prop, the input appears and is labelled.
    rerender(
      <LimitField
        label="Max States"
        name="maxStates"
        unlimited={false}
        onUnlimitedChange={onUnlimitedChange}
        value={12}
        onValueChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Max States');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(12);
  });

  it('reports typed values to onValueChange', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <LimitField
        label="Max Submissions"
        name="maxSubmissions"
        unlimited={false}
        onUnlimitedChange={vi.fn()}
        value=""
        onValueChange={onValueChange}
      />,
    );

    await user.type(screen.getByLabelText('Max Submissions'), '5');
    expect(onValueChange).toHaveBeenCalledWith('5');
  });

  // The invalid look comes from Input's own aria-invalid rules. LimitField used to add a
  // border-destructive class of its own on top, which is a second copy that could
  // disagree with the first; the attribute is the thing that has to be right.
  it('marks the number input invalid and points it at the error', async () => {
    const user = userEvent.setup();

    render(
      <LimitField
        label="Submissions"
        name="submissions"
        unlimited={false}
        onUnlimitedChange={() => {}}
        value={3}
        onValueChange={() => {}}
        error="Enter at least 1"
      />,
    );

    const input = screen.getByLabelText('Submissions');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'submissions-value-error');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter at least 1');
    expect(alert).toHaveAttribute('id', 'submissions-value-error');

    // Nothing to assert about the segmented control here beyond it still being usable.
    await user.click(screen.getByRole('radio', { name: 'Unlimited' }));
  });

  it('does not announce an error while Unlimited hides the input', () => {
    render(
      <LimitField
        label="Submissions"
        name="submissions"
        unlimited
        onUnlimitedChange={() => {}}
        value={null}
        onValueChange={() => {}}
        error="Enter at least 1"
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
