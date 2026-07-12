/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import DuplicateCourseDialog from './DuplicateCourseDialog';

const toastErrorMock = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
vi.mock('@/components/ui/InputGroup', () =>
  import('@/test/mocks/ui').then((mod) => mod.inputGroupMock),
);

vi.mock('@/components/ui/SearchableMultiSelect', () => ({
  SearchableMultiSelect: ({
    label,
    items,
    value = [],
    onChange,
    error,
  }: {
    label: string;
    items: Array<{ id: string; label: string }>;
    value: string[];
    onChange: (next: string[]) => void;
    error?: string;
  }) => (
    <fieldset>
      <legend>{label}</legend>
      {items.map((item) => (
        <label key={item.id}>
          <input
            type="checkbox"
            aria-label={item.label}
            checked={value.includes(item.id)}
            onChange={() => {
              const next = new Set(value);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              onChange(Array.from(next));
            }}
          />
          {item.label}
        </label>
      ))}
      {error ? <span role="alert">{error}</span> : null}
    </fieldset>
  ),
}));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const course = {
  id: 'c1',
  name: 'Theory of Computation',
  code: 'CS 401',
  semester: 'Fall 2025',
  credits: 3,
  startDate: '2025-08-25T14:00:00Z',
  endDate: '2025-12-10T14:00:00Z',
  registrationOpenAt: '2025-05-01T00:00:00Z',
  registrationCloseAt: '2025-08-20T00:00:00Z',
} as any;

const originalFetch = global.fetch;
const fetchMock = vi.fn();
let originalLocation: Location;

describe('DuplicateCourseDialog', () => {
  beforeAll(() => {
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation },
      writable: true,
      configurable: true,
    });
  });

  afterAll(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      configurable: true,
    });
  });

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    toastErrorMock.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Walk the wizard: Details -> Schedule -> Content -> Roster -> Review.
  const clickNext = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Next' }));
  };

  // The dialog fetches the faculty list on open — resolve that first request.
  const resolveFacultyRequest = () =>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'faculty-1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
      ],
    } as Response);

  const renderDialog = (props: Partial<React.ComponentProps<typeof DuplicateCourseDialog>>) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <DuplicateCourseDialog
          open
          setOpen={vi.fn()}
          course={course}
          timeZone="UTC"
          onSuccess={vi.fn()}
          {...props}
        />
      </QueryClientProvider>,
    );
  };

  it('duplicates a course after completing all steps', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onSuccess = vi.fn();

    resolveFacultyRequest();
    renderDialog({ setOpen, onSuccess });

    // Details
    await user.clear(screen.getByLabelText('Course Name'));
    await user.type(screen.getByLabelText('Course Name'), 'Advanced Theory');
    await user.clear(screen.getByLabelText('Course Code'));
    await user.type(screen.getByLabelText('Course Code'), 'CS 450');
    await user.clear(screen.getByLabelText('Semester'));
    await user.type(screen.getByLabelText('Semester'), 'Spring 2026');
    await user.clear(screen.getByLabelText('Credits'));
    await user.type(screen.getByLabelText('Credits'), '4');
    await clickNext(user);

    // Schedule (prefilled from the source course)
    await screen.findByLabelText('Start Date & Time');
    await clickNext(user);

    // Content
    await user.click(await screen.findByText('Assignments only'));
    await clickNext(user);

    // Roster: copy the faculty roster AND pick an extra faculty member.
    await user.click(await screen.findByText('Copy faculty roster'));
    await user.click(await screen.findByLabelText('Ada Lovelace'));
    await clickNext(user);

    // Review: no submit yet (only the faculty fetch has fired), confirm required.
    await screen.findByText('Advanced Theory');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByLabelText(/I confirm I want to duplicate/i));

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'new-course-id' }),
    } as Response);

    await user.click(screen.getByRole('button', { name: 'Duplicate Course' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/courses/${course.id}/duplicate`);

    const [, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(requestInit.body as string)).toMatchObject({
      title: 'Advanced Theory',
      code: 'CS 450',
      copyAssignments: true,
      copyProblems: false,
      copyFaculty: true,
      instructorIds: ['faculty-1'],
    });

    expect(onSuccess).toHaveBeenCalledWith('new-course-id');
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('does not submit when course id is missing', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();

    resolveFacultyRequest();
    renderDialog({ setOpen, course: null });

    // Details
    await user.type(screen.getByLabelText('Course Name'), 'Course Copy');
    await user.type(screen.getByLabelText('Course Code'), 'CS 450');
    await user.type(screen.getByLabelText('Semester'), 'Spring 2026');
    await user.clear(screen.getByLabelText('Credits'));
    await user.type(screen.getByLabelText('Credits'), '3');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Schedule
    await user.type(await screen.findByLabelText('Start Date & Time'), '2026-01-15T12:00');
    await user.type(screen.getByLabelText('End Date & Time'), '2026-05-15T12:00');
    await user.type(screen.getByLabelText('Self Registration Opens'), '2026-01-01T12:00');
    await user.type(screen.getByLabelText('Self Registration Closes'), '2026-01-14T12:00');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Content -> Roster (must satisfy the faculty requirement) -> Review
    await screen.findByText('What would you like to copy?');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByText('Copy faculty roster'));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(await screen.findByLabelText(/I confirm I want to duplicate/i));
    await user.click(screen.getByRole('button', { name: 'Duplicate Course' }));

    // Only the faculty-list fetch fired — no duplicate request went out.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Cannot duplicate course because the course ID is missing.',
    );
  });

  it('holds the Details step when credits are invalid', async () => {
    const user = userEvent.setup();

    resolveFacultyRequest();
    renderDialog({});

    await user.clear(screen.getByLabelText('Credits'));
    await user.type(screen.getByLabelText('Credits'), '7');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Still on Details: the Schedule fields never mount.
    expect(screen.queryByLabelText('Start Date & Time')).toBeNull();
    expect(screen.getByText('Credits must be an integer between 1 and 6.')).toBeInTheDocument();
  });

  it('holds the Roster step when no faculty would end up on the copy', async () => {
    const user = userEvent.setup();

    resolveFacultyRequest();
    renderDialog({});

    // Details and Schedule are prefilled from the source course.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByLabelText('Start Date & Time');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('What would you like to copy?');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Roster: neither copyFaculty nor a picked faculty member -> blocked.
    await screen.findByText('Copy faculty roster');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(
      await screen.findByText('Copy the faculty roster or pick at least one faculty member.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/I confirm I want to duplicate/i)).toBeNull();

    // Picking a faculty member unblocks it.
    await user.click(screen.getByLabelText('Ada Lovelace'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/I confirm I want to duplicate/i)).toBeInTheDocument();
  });
});
