/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarClient from './CalendarClient';

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/components/ui/calendar', () => ({
  Calendar: ({ onMonthChange, month }: { onMonthChange?: (date: Date) => void; month: Date }) => (
    <div>
      <button
        type="button"
        onClick={() => onMonthChange?.(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
      >
        Mock Month Change
      </button>
    </div>
  ),
}));

vi.mock('@/components/dialogs/DayAssignmentsDialog', () => ({
  default: () => null,
}));

vi.mock('@/components/modules/DueDateModule', () => ({
  DueDateModule: ({ assignments }: { assignments: unknown[] }) => (
    <div data-testid="due-date-count">{assignments.length}</div>
  ),
}));

describe('CalendarClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches assignment range once on initial mount', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    render(<CalendarClient />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('/api/assignments/range', expect.any(Object));
    });
  });

  it('uses server-initial assignments without immediate fetch', () => {
    const initialAssignments = [
      {
        id: 'a1',
        title: 'Assignment 1',
        courseId: 'c1',
        dueDate: new Date('2026-03-10T12:00:00.000Z'),
        course: { id: 'c1', code: 'CS101', name: 'Course 1' },
      },
    ];

    render(
      <CalendarClient
        initialAssignments={initialAssignments}
        initialMonth={new Date('2026-03-01T00:00:00.000Z').toISOString()}
      />,
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId('due-date-count')).toHaveTextContent('1');
  });

  it('fetches one additional time when navigating months', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    render(<CalendarClient />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByLabelText('Next month'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('shows error state and retries successfully', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ ok: true, json: async () => [] });

    render(<CalendarClient />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to load calendar assignments. Please try again.',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('shows loading message while request is in flight', async () => {
    let resolveFetch: ((value: unknown) => void) | null = null;
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    (global.fetch as ReturnType<typeof vi.fn>).mockReturnValue(pending);

    render(<CalendarClient />);

    expect(screen.getByText('Loading assignments...')).toBeInTheDocument();

    resolveFetch?.({ ok: true, json: async () => [] });

    await waitFor(() => {
      expect(screen.queryByText('Loading assignments...')).not.toBeInTheDocument();
    });
  });
});
