/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DateTimeField } from './DateTimeField';

/**
 * The field is two inputs holding one `YYYY-MM-DDTHH:mm` string, so what matters is the
 * arithmetic between them: what a bare date becomes, what clearing either half does, and
 * that a time typed before a date is not thrown away.
 */
function Harness({
  initial = '',
  defaultTime,
  min,
}: {
  initial?: string;
  defaultTime?: string;
  min?: string;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <>
      <DateTimeField
        label="Due"
        name="due"
        value={value}
        onChange={setValue}
        defaultTime={defaultTime}
        min={min}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const dateInput = () => screen.getByLabelText('Due, date');
const timeInput = () => screen.getByLabelText('Due, time');
const emitted = () => screen.getByTestId('value').textContent;

describe('DateTimeField', () => {
  it('splits an existing value across the two inputs', () => {
    render(<Harness initial="2026-09-03T14:30" />);
    expect(dateInput()).toHaveValue('2026-09-03');
    expect(timeInput()).toHaveValue('14:30');
  });

  it('names both halves after the field, so four of them on one form stay apart', () => {
    render(<Harness />);
    // The visible label is still one label, and it points at the date input.
    expect(screen.getByText('Due')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Due' })).toBeInTheDocument();
  });

  it('turns a bare date into midnight by default', () => {
    render(<Harness />);
    fireEvent.change(dateInput(), { target: { value: '2026-09-03' } });
    expect(emitted()).toBe('2026-09-03T00:00');
  });

  it('turns a bare date into the end of the day when asked (a deadline)', () => {
    render(<Harness defaultTime="23:59" />);
    fireEvent.change(dateInput(), { target: { value: '2026-09-03' } });
    expect(emitted()).toBe('2026-09-03T23:59');
  });

  it('combines the two halves when the time changes', () => {
    render(<Harness initial="2026-09-03T00:00" />);
    fireEvent.change(timeInput(), { target: { value: '17:45' } });
    expect(emitted()).toBe('2026-09-03T17:45');
  });

  it('clears the whole value with the date, but keeps the time on screen', () => {
    render(<Harness initial="2026-09-03T14:30" />);
    fireEvent.change(dateInput(), { target: { value: '' } });
    expect(emitted()).toBe('');
    // Still shown, so setting a date again does not mean retyping the time.
    expect(timeInput()).toHaveValue('14:30');
    fireEvent.change(dateInput(), { target: { value: '2026-10-01' } });
    expect(emitted()).toBe('2026-10-01T14:30');
  });

  it('snaps an emptied time back to the default rather than leaving a date half set', () => {
    render(<Harness initial="2026-09-03T14:30" defaultTime="23:59" />);
    fireEvent.change(timeInput(), { target: { value: '' } });
    expect(emitted()).toBe('2026-09-03T23:59');
    expect(timeInput()).toHaveValue('23:59');
  });

  it('keeps a time typed before any date is chosen', () => {
    render(<Harness />);
    fireEvent.change(timeInput(), { target: { value: '09:15' } });
    // Nothing to emit yet: a time with no date is not a value.
    expect(emitted()).toBe('');
    fireEvent.change(dateInput(), { target: { value: '2026-09-03' } });
    expect(emitted()).toBe('2026-09-03T09:15');
  });

  it('binds the lower bound to the date half only', () => {
    render(<Harness min="2026-09-01T08:00" />);
    expect(dateInput()).toHaveAttribute('min', '2026-09-01');
    expect(timeInput()).not.toHaveAttribute('min');
  });

  it('marks both halves invalid and points them at one error message', () => {
    render(
      <DateTimeField label="Due" name="due" value="" onChange={vi.fn()} error="Pick a date." />,
    );
    expect(dateInput()).toHaveAttribute('aria-invalid', 'true');
    expect(timeInput()).toHaveAttribute('aria-invalid', 'true');
    expect(dateInput()).toHaveAttribute('aria-describedby', 'due-error');
    expect(timeInput()).toHaveAttribute('aria-describedby', 'due-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Pick a date.');
  });
});
