/** @vitest-environment jsdom */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SwitchField from './SwitchField';

describe('SwitchField', () => {
  it('wires label, description, and aria attributes', () => {
    render(
      <SwitchField
        label="Autograder"
        name="autograder"
        checked={false}
        onCheckedChange={() => {}}
        description="Enable automatic grading"
        additionalDescribedBy="autograder-hint"
      />,
    );

    const control = screen.getByRole('switch', { name: 'Autograder' });
    expect(control).toHaveAttribute('aria-describedby', 'autograder-desc autograder-hint');
    expect(screen.getByText('Enable automatic grading')).toHaveAttribute('id', 'autograder-desc');
  });

  it('calls onCheckedChange when toggled', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <SwitchField
        label="Unlimited"
        name="unlimited"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.click(screen.getByRole('switch', { name: 'Unlimited' }));
    expect(onCheckedChange).toHaveBeenCalled();
  });

  it('shows error and marks invalid', () => {
    render(
      <SwitchField
        label="Autograder"
        name="autograder"
        checked={true}
        onCheckedChange={() => {}}
        error="Autograder setting is required"
      />,
    );

    expect(screen.getByText('Autograder setting is required')).toHaveAttribute(
      'id',
      'autograder-error',
    );
    expect(screen.getByRole('switch', { name: 'Autograder' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('supports inline description under label', () => {
    render(
      <SwitchField
        label="Allow Late Submissions"
        name="allow-late-submissions"
        checked={true}
        onCheckedChange={() => {}}
        description="Students can submit after the deadline until a cutoff date."
        descriptionPlacement="inline"
      />,
    );

    expect(
      screen.getByText('Students can submit after the deadline until a cutoff date.'),
    ).toHaveAttribute('id', 'allow-late-submissions-desc');
    expect(screen.getByRole('switch', { name: 'Allow Late Submissions' })).toHaveAttribute(
      'aria-describedby',
      'allow-late-submissions-desc',
    );
  });
});
