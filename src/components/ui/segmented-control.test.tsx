/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SegmentedControl } from './segmented-control';

const OPTIONS = [
  { value: 'unlimited', label: 'Unlimited' },
  { value: 'limited', label: 'Limited' },
];

function renderControl(props: Partial<React.ComponentProps<typeof SegmentedControl>> = {}) {
  const onValueChange = vi.fn();
  render(
    <SegmentedControl
      name="limit-mode"
      ariaLabel="Submission limit"
      value="unlimited"
      onValueChange={onValueChange}
      options={OPTIONS}
      {...props}
    />,
  );
  return { onValueChange };
}

describe('SegmentedControl', () => {
  // Native radios are the whole point of this component: the group semantics, the
  // roving arrow-key behaviour and the exclusivity all come from the platform rather
  // than being re-implemented. A rewrite onto buttons would pass a click test and lose
  // every one of those, so the roles are asserted, not just the labels.
  it('exposes a named radio group with one checked option', () => {
    renderControl();

    const group = screen.getByRole('radiogroup', { name: 'Submission limit' });
    expect(group).toBeInTheDocument();

    expect(screen.getByRole('radio', { name: 'Unlimited' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Limited' })).not.toBeChecked();
  });

  it('reports the picked value when a segment is clicked', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderControl();

    await user.click(screen.getByRole('radio', { name: 'Limited' }));

    expect(onValueChange).toHaveBeenCalledWith('limited');
  });

  it('moves between segments with the arrow keys', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderControl();

    await user.tab();
    expect(screen.getByRole('radio', { name: 'Unlimited' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(onValueChange).toHaveBeenCalledWith('limited');
  });

  it('takes no input when disabled', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderControl({ disabled: true });

    expect(screen.getByRole('radio', { name: 'Limited' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Limited' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
