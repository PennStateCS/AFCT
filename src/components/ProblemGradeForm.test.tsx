/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ProblemGradeForm from './ProblemGradeForm';

describe('ProblemGradeForm', () => {
  it('enables save when value is changed and submits', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onChange = vi.fn();

    render(<ProblemGradeForm value="7" currentGrade={5} onChange={onChange} onSubmit={onSubmit} />);

    const saveButton = screen.getByRole('button', { name: 'Save Grade' });
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables save when value is invalid and shows error', () => {
    render(
      <ProblemGradeForm
        value="abc"
        currentGrade={5}
        onChange={() => {}}
        onSubmit={() => {}}
        error="Grade must be numeric"
      />,
    );

    expect(screen.getByRole('button', { name: 'Save Grade' })).toBeDisabled();
    expect(screen.getByText('Grade must be numeric')).toBeInTheDocument();
  });

  it('handles keyboard shortcuts for Enter and Escape', () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();

    render(<ProblemGradeForm value="8" currentGrade={5} onChange={onChange} onSubmit={onSubmit} />);

    const input = screen.getByLabelText('Problem grade');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onChange).toHaveBeenCalledWith('5');
  });
});
