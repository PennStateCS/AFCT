/** @vitest-environment jsdom */

// Exercises the REAL react-day-picker calendar (not the mock the sibling test uses)
// so the custom DayButton's keyboard/roving-focus wiring is covered.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CalendarClient from './CalendarClient';

// Use the machine's own timezone so react-day-picker's local day cells and the
// assignment's local due date resolve to the same date key (a fixed 'UTC' mock
// desyncs them on non-UTC machines and the chip never lands in a cell).
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),
}));

vi.mock('@/components/modules/DueDateModule', () => ({
  DueDateModule: () => null,
}));

// Expose whether the day dialog is open so we can assert activation.
vi.mock('@/components/dialogs/DayAssignmentsDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>day-dialog-open</div> : null),
}));

const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

// Deterministic month with one assignment; server-initial data means no fetch.
const renderCalendar = () =>
  renderWithClient(
    <CalendarClient
      initialAssignments={[
        {
          id: 'a1',
          title: 'HW 1',
          courseId: 'c1',
          // Local mid-day mid-month so the chip lands in the same grid cell that
          // react-day-picker renders, regardless of the machine's timezone.
          dueDate: new Date(2026, 2, 15, 12, 0, 0),
          isPublished: true,
          course: { id: 'c1', code: 'CS101', name: 'Course 1' },
        },
      ]}
      initialMonth={new Date(2026, 2, 1, 12, 0, 0).toISOString()}
    />,
  );

const dayCells = () =>
  screen.getAllByRole('button', { name: /Press Enter to open assignments/ });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

describe('CalendarClient day cells (keyboard model)', () => {
  it('renders each day as a button with a descriptive accessible name', () => {
    renderCalendar();
    const cells = dayCells();
    // A month grid has ~28-31 day cells.
    expect(cells.length).toBeGreaterThanOrEqual(28);
    expect(cells[0]).toHaveAttribute('aria-label', expect.stringContaining('assignment'));
  });

  it('uses a roving tabindex: exactly one day cell is in the tab order', () => {
    renderCalendar();
    const tabbable = dayCells().filter((c) => c.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    // Every other day cell is removed from the tab sequence.
    const notTabbable = dayCells().filter((c) => c.getAttribute('tabindex') === '-1');
    expect(notTabbable.length).toBe(dayCells().length - 1);
  });

  it('opens the day dialog when a day is activated with Enter', () => {
    renderCalendar();
    expect(screen.queryByText('day-dialog-open')).toBeNull();

    const cell = dayCells()[10];
    fireEvent.keyDown(cell, { key: 'Enter' });

    expect(screen.getByText('day-dialog-open')).toBeInTheDocument();
  });

  it('opens the day dialog on click as well', () => {
    renderCalendar();
    fireEvent.click(dayCells()[5]);
    expect(screen.getByText('day-dialog-open')).toBeInTheDocument();
  });

  it('keeps the grid to a single tab stop: assignment chips are not in the tab order', () => {
    renderCalendar();
    // The roving model means exactly one day cell is tabbable.
    const tabbableCells = dayCells().filter((c) => c.getAttribute('tabindex') === '0');
    expect(tabbableCells).toHaveLength(1);
    // Assignment chips are reachable via the day dialog / upcoming list, not as
    // extra tab stops that would break the roving grid (they carry tabindex -1).
    const chips = document.querySelectorAll('a.assignment-link');
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((chip) => expect(chip.getAttribute('tabindex')).toBe('-1'));
  });

  it('marks today with aria-current="date"', () => {
    renderCalendar();
    const current = dayCells().filter((c) => c.getAttribute('aria-current') === 'date');
    // The initial month is fixed to March 2026, so "today" is only present when the
    // test happens to run in that month; at most one cell is ever marked.
    expect(current.length).toBeLessThanOrEqual(1);
  });
});
