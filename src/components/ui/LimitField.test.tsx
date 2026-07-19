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
});
