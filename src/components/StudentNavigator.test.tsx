/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
 * The group panel is fed by a prop now, from the review-data the parent already holds, so
 * these render it directly rather than stubbing a second fetch.
 */
const renderWithGroup = (groupInfo: Record<string, unknown>) => {
  const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ dueDate: '2026-01-10T00:00:00.000Z', allowLateSubmissions: false }),
  });
  return renderWithClient(
    <StudentNavigator
      {...baseProps}
      groupInfo={groupInfo as unknown as StudentNavigatorProps['groupInfo']}
    />,
  );
};

describe('the selected student\'s own schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  // Whether the assignment is group work now lives in the assignment header, since it never
  // changes as you page through students. What belongs here is what DOES change.
  it('names the group this student submits with', async () => {
    renderWithGroup({
      isGroupAssignment: true,
      isGroup: true,
      group: { id: 'g1', name: 'Group 3' },
      members: [{ id: 's2', firstName: 'Grace', lastName: 'Hopper' }],
    });

    await waitFor(() =>
      expect(screen.getByText(/Submitting with Group 3: Grace Hopper/)).toBeInTheDocument(),
    );
  });

  // A group assignment with nobody to submit alongside is a setup mistake, not a fact about
  // this student's work.
  it('warns when the student is in no group', async () => {
    renderWithGroup({ isGroupAssignment: true, isGroup: false, group: null, members: [] });

    await waitFor(() => expect(screen.getByText(/Not in a group/)).toBeInTheDocument());
  });

  it('does not warn on an individual assignment', async () => {
    renderWithGroup({ isGroupAssignment: false, isGroup: false, group: null, members: [] });

    await waitFor(() => expect(screen.getByText(/Due:/)).toBeInTheDocument());
    expect(screen.queryByText(/Not in a group/)).not.toBeInTheDocument();
  });

  // Which kind matters: a whole group being given longer is a different situation from one
  // student being given longer, and the resolver already knows which it was.
  it('distinguishes a group override from a student one', async () => {
    renderWithGroup({
      isGroupAssignment: true,
      isGroup: true,
      group: { id: 'g1', name: 'Group 3' },
      members: [],
      effective: {
        unlockAt: null,
        dueDate: '2026-02-01T00:00:00.000Z',
        lateCutoff: null,
        allowLateSubmissions: false,
        source: 'group-override',
      },
    });

    await waitFor(() => expect(screen.getByText('(group override)')).toBeInTheDocument());
  });

  it('labels a student-targeted override', async () => {
    renderWithGroup({
      isGroupAssignment: false,
      isGroup: false,
      group: null,
      members: [],
      effective: {
        unlockAt: null,
        dueDate: '2026-02-01T00:00:00.000Z',
        lateCutoff: null,
        allowLateSubmissions: false,
        source: 'student-override',
      },
    });

    await waitFor(() => expect(screen.getByText('(student override)')).toBeInTheDocument());
  });

  // Overrides merge field by field, so one can move the late window and leave the due date
  // alone. Marking Due regardless would point at the one value that did not change.
  it('marks only the fields the override actually changed', async () => {
    renderWithGroup({
      isGroupAssignment: false,
      isGroup: false,
      group: null,
      members: [],
      effective: {
        unlockAt: null,
        // Same due date the assignment has; only the late window moved.
        dueDate: '2026-01-10T00:00:00.000Z',
        lateCutoff: '2026-01-20T00:00:00.000Z',
        allowLateSubmissions: true,
        source: 'student-override',
      },
    });

    // Allow Late and Late Cutoff changed, the due date did not.
    await waitFor(() => expect(screen.getAllByText('(student override)')).toHaveLength(2));
    const due = screen.getByText('Due:').parentElement;
    expect(due?.textContent).not.toContain('override');
  });

  // The whole point of the fold: this component must not make its own per-student call.
  it('does not fetch student-group itself', async () => {
    renderWithGroup({
      isGroupAssignment: true,
      isGroup: true,
      group: { id: 'g1', name: 'G' },
      members: [],
    });

    await waitFor(() => expect(screen.getByText(/Submitting with G/)).toBeInTheDocument());
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('student-group'))).toBe(false);
  });
});

describe('student names', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  const twoStudents: StudentNavigatorProps = {
    ...baseProps,
    students: [
      { id: 's1', firstName: 'Ada', lastName: 'Lovelace' },
      { id: 's2', firstName: 'Grace', lastName: 'Hopper' },
      { id: 's3', firstName: null, lastName: 'Turing' },
      { id: 's4', firstName: 'Mononymous', lastName: null },
    ],
  };

  // Staff scan this list by surname, the way a roster or gradebook reads.
  it('shows the selected student as "Last, First"', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ dueDate: '2026-01-10T00:00:00.000Z' }) });

    renderWithClient(<StudentNavigator {...twoStudents} />);

    await waitFor(() => expect(screen.getByText('Lovelace, Ada')).toBeInTheDocument());
  });

  // A student with only one name recorded must not come out as ", Ada" or "Turing, ".
  it('omits the comma when only one name is recorded', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ dueDate: '2026-01-10T00:00:00.000Z' }) });

    renderWithClient(<StudentNavigator {...twoStudents} selectedIndex={2} />);
    await waitFor(() => expect(screen.getByText('Turing')).toBeInTheDocument());

    renderWithClient(<StudentNavigator {...twoStudents} selectedIndex={3} />);
    await waitFor(() => expect(screen.getByText('Mononymous')).toBeInTheDocument());
  });
});

describe('a very large roster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  const manyStudents = Array.from({ length: 250 }, (_, i) => ({
    id: `s${i}`,
    firstName: 'Student',
    lastName: `Name${String(i).padStart(3, '0')}`,
  }));

  const openPicker = async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ dueDate: '2026-01-10T00:00:00.000Z', allowLateSubmissions: false }),
    });
    renderWithClient(<StudentNavigator {...baseProps} students={manyStudents} />);
    await userEvent.click(screen.getByRole('button', { name: /Name000/ }));
  };

  // Every row is a Radix menu item, so drawing a thousand of them on open is the thing that
  // makes a large course feel broken.
  it('draws a bounded number of rows', async () => {
    await openPicker();

    const items = await screen.findAllByRole('menuitem');
    expect(items.length).toBeLessThanOrEqual(100);
  });

  // Truncating in silence would read as "that student is not enrolled".
  it('says the list is capped, and how many there are', async () => {
    await openPicker();

    expect(await screen.findByText(/Showing the first 100 of 250/)).toBeInTheDocument();
  });

  it('drops the notice once a search narrows the list', async () => {
    await openPicker();
    await screen.findByText(/Showing the first 100 of 250/);

    await userEvent.type(screen.getByLabelText('Search students by name'), 'Name123');

    await waitFor(() =>
      expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Name123, Student')).toBeInTheDocument();
  });
});
