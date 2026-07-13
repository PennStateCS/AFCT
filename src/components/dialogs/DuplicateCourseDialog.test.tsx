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
let originalLocation: Location;

// On open the dialog fires three GETs (faculty list, TA list, current roster) plus the
// duplicate POST on submit; route by URL so order doesn't matter. `facultyList` seeds the
// "Add faculty" multiselect (the mock renders a checkbox per item, aria-labelled by name).
const routeFetch = () =>
  vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/duplicate')) {
      const body = JSON.stringify({ id: 'new-course-id' });
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(body),
        text: async () => body,
      } as Response;
    }
    if (init?.method === undefined && u.includes('role=FACULTY')) {
      return {
        ok: true,
        json: async () => [
          { id: 'faculty-1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
        ],
      } as Response;
    }
    if (u.includes('role=TA')) return { ok: true, json: async () => [] } as Response;
    if (u.includes('view=roster')) {
      return { ok: true, json: async () => ({ enrolled: [] }) } as Response;
    }
    throw new Error(`Unexpected fetch: ${u}`);
  });
let fetchMock = routeFetch();

const duplicateCalls = () =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes('/duplicate'));

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
    fetchMock = routeFetch();
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

    // Roster: add a faculty member via the "Add faculty" picker.
    await user.click(await screen.findByLabelText('Ada Lovelace'));
    await clickNext(user);

    // Review: nothing submitted yet, confirm required.
    await screen.findByText('Advanced Theory');
    expect(duplicateCalls()).toHaveLength(0);
    await user.click(screen.getByLabelText(/I confirm I want to duplicate/i));

    await user.click(screen.getByRole('button', { name: 'Duplicate Course' }));

    await waitFor(() => expect(duplicateCalls()).toHaveLength(1));
    const [url, requestInit] = duplicateCalls()[0] as [string, RequestInit];
    expect(url).toBe(`/api/courses/${course.id}/duplicate`);
    expect(JSON.parse(requestInit.body as string)).toMatchObject({
      title: 'Advanced Theory',
      code: 'CS 450',
      copyAssignments: true,
      copyProblems: false,
      instructorIds: ['faculty-1'],
      taIds: [],
    });

    expect(onSuccess).toHaveBeenCalledWith('new-course-id');
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('does not submit when course id is missing', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();

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

    // Content -> Roster (satisfy the faculty requirement) -> Review
    await screen.findByText('What would you like to copy?');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByLabelText('Ada Lovelace'));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(await screen.findByLabelText(/I confirm I want to duplicate/i));
    await user.click(screen.getByRole('button', { name: 'Duplicate Course' }));

    // No duplicate request went out because the course id is missing.
    expect(duplicateCalls()).toHaveLength(0);
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Cannot duplicate course because the course ID is missing.',
    );
  });

  it('holds the Details step when credits are invalid', async () => {
    const user = userEvent.setup();

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

    renderDialog({});

    // Details and Schedule are prefilled from the source course.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByLabelText('Start Date & Time');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('What would you like to copy?');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Roster: no faculty picked -> the step holds with a validation error.
    await screen.findByText('Add faculty');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Pick at least one faculty member.')).toBeInTheDocument();
    expect(screen.queryByText(/I confirm I want to duplicate/i)).toBeNull();

    // Picking a faculty member unblocks it.
    await user.click(screen.getByLabelText('Ada Lovelace'));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/I confirm I want to duplicate/i)).toBeInTheDocument();
  });
});
