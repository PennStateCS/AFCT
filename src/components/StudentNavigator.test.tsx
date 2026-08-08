/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StudentNavigator, { type StudentNavigatorProps } from './StudentNavigator';

// Render with a fresh QueryClient per test (retry off, no lingering cache) so the
// assignment query starts clean each time.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

// The timezone hook and the date formatter are external concerns; stub them so the
// rendered Due value is deterministic and independent of the host timezone.
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));

vi.mock('@/lib/date-format', () => ({
  formatDateTimeInTimeZone: (value: string | Date) => `formatted:${String(value)}`,
}));

const baseProps: StudentNavigatorProps = {
  students: [{ id: 's1', firstName: 'Ada', lastName: 'Lovelace' }],
  selectedIndex: 0,
  onSelectStudent: vi.fn(),
  onPrev: vi.fn(),
  onNext: vi.fn(),
  courseId: 'c1',
  assignmentId: 'a1',
};

describe('StudentNavigator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('fetches the assignment on mount and renders a value from the response', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        dueDate: '2026-01-10T00:00:00.000Z',
        allowLateSubmissions: true,
        lateCutoff: '2026-01-12T00:00:00.000Z',
      }),
    });

    renderWithClient(<StudentNavigator {...baseProps} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/assignments/a1?view=problems');
    });

    // Derived from the response: allowLateSubmissions -> "Yes", and the formatted
    // due date comes through the stubbed formatter.
    await waitFor(() => {
      expect(screen.getByText('Yes')).toBeInTheDocument();
      expect(
        screen.getByText('formatted:2026-01-10T00:00:00.000Z'),
      ).toBeInTheDocument();
    });
  });

  it('shows the loading label while the query is in flight', () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    // Never resolves -> query stays pending.
    fetchMock.mockReturnValue(new Promise(() => {}));

    renderWithClient(<StudentNavigator {...baseProps} />);

    expect(screen.getByText('Loading assignment...')).toBeInTheDocument();
  });

  it('renders no assignment detail when the fetch fails', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    renderWithClient(<StudentNavigator {...baseProps} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/courses/c1/assignments/a1?view=problems');
    });

    // On error the component renders no assignment block and no loading label.
    await waitFor(() => {
      expect(screen.queryByText('Loading assignment...')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Due:')).not.toBeInTheDocument();
    // The student picker (unrelated UI) still renders, now with its "N of M" position.
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
  });
});

/**
 * Route the two reads this component makes: the assignment shell and the per-student group
 * info. Both go through the same global fetch, so they are matched by URL.
 */
const stubFetch = (groupInfo: Record<string, unknown>) => {
  const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockImplementation((url: string) => {
    if (String(url).includes('student-group')) {
      return Promise.resolve({ ok: true, json: async () => groupInfo });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ dueDate: '2026-01-10T00:00:00.000Z', allowLateSubmissions: false }),
    });
  });
  return fetchMock;
};

describe('individual versus group', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('says Individual for an assignment that is not a group assignment', async () => {
    stubFetch({ isGroupAssignment: false, isGroup: false, group: null, members: [] });

    renderWithClient(<StudentNavigator {...baseProps} />);

    await waitFor(() => expect(screen.getByText('Individual')).toBeInTheDocument());
  });

  it('names the group when the student has one', async () => {
    stubFetch({
      isGroupAssignment: true,
      isGroup: true,
      group: { id: 'g1', name: 'Group 3' },
      members: [{ id: 's2', firstName: 'Grace', lastName: 'Hopper' }],
    });

    renderWithClient(<StudentNavigator {...baseProps} />);

    await waitFor(() => expect(screen.getByText('Group (Group 3)')).toBeInTheDocument());
    expect(screen.getByText(/Grace Hopper/)).toBeInTheDocument();
  });

  // The case the old code got wrong: it read the student's group membership rather than
  // the assignment, so this rendered as a normal individual submission.
  it('still says Group, and warns, when the student is in no group', async () => {
    stubFetch({ isGroupAssignment: true, isGroup: false, group: null, members: [] });

    renderWithClient(<StudentNavigator {...baseProps} />);

    await waitFor(() => expect(screen.getByText('Group')).toBeInTheDocument());
    expect(screen.getByText(/Not in a group/)).toBeInTheDocument();
  });

  it('does not warn on an individual assignment', async () => {
    stubFetch({ isGroupAssignment: false, isGroup: false, group: null, members: [] });

    renderWithClient(<StudentNavigator {...baseProps} />);

    await waitFor(() => expect(screen.getByText('Individual')).toBeInTheDocument());
    expect(screen.queryByText(/Not in a group/)).not.toBeInTheDocument();
  });
});
