/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CalendarClient from './CalendarClient';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so the
// assignment-range query starts clean each time.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

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

const okJson = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
const fetchMock = () => global.fetch as ReturnType<typeof vi.fn>;
// Calls the component made to the assignment-range endpoint (there's now also a
// courses fetch on mount, so total call count is no longer a clean signal).
const assignmentCalls = () =>
  fetchMock().mock.calls.filter((c) => String(c[0]).startsWith('/api/me/assignments'));

describe('CalendarClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    // Default: every endpoint returns an empty list. Tests override the assignment
    // behaviour where they need pending/error states.
    vi.stubGlobal('fetch', vi.fn(() => okJson([])).mockName('fetch') as unknown as typeof fetch);
  });

  it('fetches assignment range once on initial mount', async () => {
    renderWithClient(<CalendarClient />);

    await waitFor(() => {
      expect(assignmentCalls()).toHaveLength(1);
      expect(assignmentCalls()[0][0]).toBe('/api/me/assignments');
    });
  });

  it('uses server-initial assignments without fetching the range', async () => {
    const initialAssignments = [
      {
        id: 'a1',
        title: 'Assignment 1',
        courseId: 'c1',
        dueDate: new Date('2026-03-10T12:00:00.000Z'),
        course: { id: 'c1', code: 'CS101', name: 'Course 1' },
      },
    ];

    renderWithClient(
      <CalendarClient
        initialAssignments={initialAssignments}
        initialMonth={new Date('2026-03-01T00:00:00.000Z').toISOString()}
      />,
    );

    // The range query is seeded, so only the courses fetch (if any) fires.
    expect(assignmentCalls()).toHaveLength(0);
    expect(screen.getByTestId('due-date-count')).toHaveTextContent('1');
  });

  it('fetches one additional time when navigating months', async () => {
    renderWithClient(<CalendarClient />);

    await waitFor(() => expect(assignmentCalls()).toHaveLength(1));

    fireEvent.click(screen.getByLabelText('Next month'));

    await waitFor(() => expect(assignmentCalls()).toHaveLength(2));
  });

  it('shows error state and retries successfully', async () => {
    let failNextAssignments = true;
    fetchMock().mockImplementation((url: string) => {
      if (String(url).startsWith('/api/me/courses')) return okJson([]);
      if (failNextAssignments) {
        failNextAssignments = false;
        return Promise.reject(new Error('network error'));
      }
      return okJson([]);
    });

    renderWithClient(<CalendarClient />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to load calendar assignments. Please try again.',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(assignmentCalls().length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('shows loading message while request is in flight', async () => {
    let resolveAssignments: ((value: unknown) => void) | null = null;
    fetchMock().mockImplementation((url: string) => {
      if (String(url).startsWith('/api/me/courses')) return okJson([]);
      return new Promise((resolve) => {
        resolveAssignments = () => resolve({ ok: true, json: async () => [] });
      });
    });

    renderWithClient(<CalendarClient />);

    expect(screen.getByText('Loading assignments...')).toBeInTheDocument();

    (resolveAssignments as ((value: unknown) => void) | null)?.(null);

    await waitFor(() => {
      expect(screen.queryByText('Loading assignments...')).not.toBeInTheDocument();
    });
  });

  it('hides a course when its box is unchecked', async () => {
    const initialAssignments = [
      {
        id: 'a1',
        title: 'A1',
        courseId: 'c1',
        dueDate: new Date('2026-03-10T12:00:00.000Z'),
        course: { id: 'c1', code: 'CS101', name: 'One' },
      },
      {
        id: 'a2',
        title: 'A2',
        courseId: 'c2',
        dueDate: new Date('2026-03-12T12:00:00.000Z'),
        course: { id: 'c2', code: 'CS102', name: 'Two' },
      },
    ];
    fetchMock().mockImplementation((url: string) => {
      if (String(url).startsWith('/api/me/courses')) {
        return okJson([
          { id: 'c1', code: 'CS101', semester: 'Spring 2026', isArchived: false },
          { id: 'c2', code: 'CS102', semester: 'Spring 2026', isArchived: false },
        ]);
      }
      return okJson([]);
    });

    renderWithClient(
      <CalendarClient
        initialAssignments={initialAssignments}
        initialMonth={new Date('2026-03-01T00:00:00.000Z').toISOString()}
      />,
    );

    // Both assignments show, and both course boxes render, checked by default.
    expect(screen.getByTestId('due-date-count')).toHaveTextContent('2');
    const cs102 = await screen.findByRole('checkbox', { name: /Show assignments for CS102/ });
    expect(cs102).toBeChecked();

    // Uncheck CS102 -> only the CS101 assignment remains.
    fireEvent.click(cs102);
    await waitFor(() => expect(screen.getByTestId('due-date-count')).toHaveTextContent('1'));
  });

  it('remembers unchecked courses across remounts', async () => {
    const initialAssignments = [
      {
        id: 'a1',
        title: 'A1',
        courseId: 'c1',
        dueDate: new Date('2026-03-10T12:00:00.000Z'),
        course: { id: 'c1', code: 'CS101', name: 'One' },
      },
      {
        id: 'a2',
        title: 'A2',
        courseId: 'c2',
        dueDate: new Date('2026-03-12T12:00:00.000Z'),
        course: { id: 'c2', code: 'CS102', name: 'Two' },
      },
    ];
    fetchMock().mockImplementation((url: string) => {
      if (String(url).startsWith('/api/me/courses')) {
        return okJson([
          { id: 'c1', code: 'CS101', semester: 'Spring 2026', isArchived: false },
          { id: 'c2', code: 'CS102', semester: 'Spring 2026', isArchived: false },
        ]);
      }
      return okJson([]);
    });
    const props = {
      initialAssignments,
      initialMonth: new Date('2026-03-01T00:00:00.000Z').toISOString(),
    };

    const { unmount } = renderWithClient(<CalendarClient {...props} />);
    const cs102 = await screen.findByRole('checkbox', { name: /Show assignments for CS102/ });
    fireEvent.click(cs102);
    await waitFor(() => expect(screen.getByTestId('due-date-count')).toHaveTextContent('1'));
    unmount();

    // A fresh mount restores the saved choice: CS102 stays hidden.
    renderWithClient(<CalendarClient {...props} />);
    const cs102Again = await screen.findByRole('checkbox', { name: /Show assignments for CS102/ });
    expect(cs102Again).not.toBeChecked();
    expect(screen.getByTestId('due-date-count')).toHaveTextContent('1');
  });
});
