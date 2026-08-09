/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import {
  GradeHoldControl,
  GradeHoldBadge,
  GradeOriginBadge,
  ProblemGradingBadge,
} from './GradeHoldControl';

const renderControl = (
  props: Partial<React.ComponentProps<typeof GradeHoldControl>> = {},
) => {
  const onChange = vi.fn();
  render(
    <GradeHoldControl
      autograderEnabled
      gradeSource="AUTOGRADER"
      gradedManually={false}
      hasGrade
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
};

describe('GradeHoldBadge', () => {
  it('names where the grade came from, not how the problem is graded', () => {
    render(<GradeHoldBadge autograderEnabled gradeSource="MANUAL" gradedManually hasGrade />);

    expect(screen.getByText('Manual override')).toBeInTheDocument();
    expect(screen.queryByText('Autograded')).not.toBeInTheDocument();
  });

  it('calls hand grading on a manual problem what it is', () => {
    render(
      <GradeHoldBadge autograderEnabled={false} gradeSource="MANUAL" gradedManually hasGrade />,
    );

    expect(screen.getByText('Manually graded')).toBeInTheDocument();
  });
});

/**
 * The two halves, for the gradebook breakdown, which has room for a column each. Together
 * they must not lose the distinction the single badge crosses into one label.
 */
describe('the split badges', () => {
  it('reports the problem setting without reference to any grade', () => {
    const { rerender } = render(<ProblemGradingBadge autograderEnabled />);
    expect(screen.getByText('Automatic')).toBeInTheDocument();

    rerender(<ProblemGradingBadge autograderEnabled={false} />);
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  // The pair that the merged label had to distinguish with different words. Here the origin
  // reads the same for both and the Grading column carries the difference.
  it('credits a person the same way on either kind of problem', () => {
    const { rerender } = render(
      <GradeOriginBadge autograderEnabled gradeSource="MANUAL" gradedManually hasGrade />,
    );
    expect(screen.getByText('Manual')).toBeInTheDocument();

    rerender(
      <GradeOriginBadge
        autograderEnabled={false}
        gradeSource="MANUAL"
        gradedManually
        hasGrade
      />,
    );
    expect(screen.getByText('Manual')).toBeInTheDocument();
  });

  it('marks a held grade, and only where something could overwrite it', () => {
    const { rerender } = render(
      <GradeOriginBadge autograderEnabled gradeSource="MANUAL" gradedManually hasGrade />,
    );
    expect(screen.getByText(', held')).toBeInTheDocument();

    rerender(
      <GradeOriginBadge
        autograderEnabled={false}
        gradeSource="MANUAL"
        gradedManually
        hasGrade
      />,
    );
    expect(screen.queryByText(', held')).not.toBeInTheDocument();
  });

  it('says so when nothing has been graded', () => {
    render(
      <GradeOriginBadge
        autograderEnabled
        gradeSource="AUTOGRADER"
        gradedManually={false}
        hasGrade={false}
      />,
    );

    expect(screen.getByText('Not graded')).toBeInTheDocument();
  });
});

describe('GradeHoldControl', () => {
  it('holds a grade straight away, with no confirmation in the way', async () => {
    const { onChange } = renderControl({ gradedManually: false });

    await userEvent.click(screen.getByRole('button', { name: 'Lock this grade' }));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  /**
   * Releasing can change a student's mark on a later re-run with nobody entering a new
   * grade, which is the whole reason this direction asks first.
   */
  it('asks before releasing a grade to the autograder', async () => {
    const { onChange } = renderControl({ gradedManually: true });

    await userEvent.click(screen.getByRole('button', { name: 'Release to autograder' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(/release this grade/i);
  });

  it('releases once the confirmation is accepted', async () => {
    const { onChange } = renderControl({ gradedManually: true });

    await userEvent.click(screen.getByRole('button', { name: 'Release to autograder' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Release to autograder' }),
    );

    expect(onChange).toHaveBeenCalledWith(false);
  });

  // The guard is only worth having if backing out actually backs out.
  it('sends nothing when the confirmation is cancelled', async () => {
    const { onChange } = renderControl({ gradedManually: true });

    await userEvent.click(screen.getByRole('button', { name: 'Release to autograder' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('says what the state means, not just what it is called', () => {
    renderControl({ gradeSource: 'MANUAL', gradedManually: true });

    expect(screen.getByText(/the autograder will not change it/i)).toBeInTheDocument();
  });

  // The badge says where the grade came from; the padlock says a re-run cannot touch it.
  it('marks a held grade with words as well as a padlock', () => {
    renderControl({ gradeSource: 'AUTOGRADER', gradedManually: true });

    expect(screen.getByText(', held')).toBeInTheDocument();
  });

  it('does not mark a released grade as held', () => {
    renderControl({ gradeSource: 'MANUAL', gradedManually: false });

    expect(screen.queryByText(', held')).not.toBeInTheDocument();
  });

  /**
   * Grade a group, apply it to everyone, then release one member. Their grade is still the
   * one a person chose; the control used to tell them the autograder had set it.
   */
  it('still credits the person who set a grade after it is released', () => {
    renderControl({ gradeSource: 'MANUAL', gradedManually: false });

    expect(screen.getByText('Manual override')).toBeInTheDocument();
    expect(screen.getByText(/a person set this grade/i)).toBeInTheDocument();
    expect(screen.queryByText(/the autograder set this grade/i)).not.toBeInTheDocument();
  });

  // Both cases where the old switch was a control with nothing on the other side of it.
  it('renders nothing on a problem the autograder does not grade', () => {
    const { container } = render(
      <GradeHoldControl
        autograderEnabled={false}
        gradeSource="MANUAL"
        gradedManually
        hasGrade
        onChange={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before there is a grade to hold', () => {
    const { container } = render(
      <GradeHoldControl
        autograderEnabled
        gradeSource="AUTOGRADER"
        gradedManually={false}
        hasGrade={false}
        onChange={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('does not act on an archived course', async () => {
    const { onChange } = renderControl({ gradedManually: false, disabled: true });

    const button = screen.getByRole('button', { name: 'Lock this grade' });
    expect(button).toBeDisabled();
    await userEvent.click(button);

    expect(onChange).not.toHaveBeenCalled();
  });
});
