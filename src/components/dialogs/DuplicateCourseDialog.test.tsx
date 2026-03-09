/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

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

  it('duplicates a course after completing all steps', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onSuccess = vi.fn();

    render(
      <DuplicateCourseDialog
        open
        setOpen={setOpen}
        course={course}
        timeZone="UTC"
        onSuccess={onSuccess}
      />,
    );

    await user.clear(screen.getByLabelText('Course Name'));
    await user.type(screen.getByLabelText('Course Name'), 'Advanced Theory');
    await user.clear(screen.getByLabelText('Course Code'));
    await user.type(screen.getByLabelText('Course Code'), 'CS 450');
    await user.clear(screen.getByLabelText('Semester'));
    await user.type(screen.getByLabelText('Semester'), 'Spring 2026');
    await user.clear(screen.getByLabelText('Credits'));
    await user.type(screen.getByLabelText('Credits'), '4');

    const nextButtonsStep1 = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
    nextButtonsStep1.disabled = false;
    await user.click(nextButtonsStep1);
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeInTheDocument());

    await user.click(screen.getByText('Assignments only'));
    await user.click(screen.getByText('Copy faculty roster'));

    const nextButtonStep2 = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
    nextButtonStep2.disabled = false;
    await user.click(nextButtonStep2);
    await waitFor(() => expect(screen.getByText(/Step 3/)).toBeInTheDocument());

    await user.click(screen.getByLabelText(/I confirm I want to duplicate/i));

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'new-course-id' }),
    } as Response);

    await user.click(screen.getByRole('button', { name: 'Duplicate Course' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/courses/${course.id}/duplicate`);

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(requestInit.body as string)).toMatchObject({
      title: 'Advanced Theory',
      code: 'CS 450',
      copyAssignments: true,
      copyProblems: false,
    });

    expect(onSuccess).toHaveBeenCalledWith('new-course-id');
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('does not submit when course id is missing', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();

    render(
      <DuplicateCourseDialog
        open
        setOpen={setOpen}
        course={null}
        timeZone="UTC"
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText('Course Name'), 'Course Copy');
    await user.type(screen.getByLabelText('Course Code'), 'CS 450');
    await user.type(screen.getByLabelText('Semester'), 'Spring 2026');
    await user.clear(screen.getByLabelText('Credits'));
    await user.type(screen.getByLabelText('Credits'), '3');
    await user.type(screen.getByLabelText('Start Date & Time'), '2026-01-15T12:00');
    await user.type(screen.getByLabelText('End Date & Time'), '2026-05-15T12:00');
    await user.type(screen.getByLabelText('Self Registration Opens'), '2026-01-01T12:00');
    await user.type(screen.getByLabelText('Self Registration Closes'), '2026-01-14T12:00');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText(/Step 3/)).toBeInTheDocument());

    await user.click(screen.getByLabelText(/I confirm I want to duplicate/i));
    await user.click(screen.getByRole('button', { name: 'Duplicate Course' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Cannot duplicate course because the course ID is missing.',
    );
  });

  it('blocks moving to step 2 when credits are invalid', async () => {
    const user = userEvent.setup();

    render(
      <DuplicateCourseDialog
        open
        setOpen={vi.fn()}
        course={course}
        timeZone="UTC"
        onSuccess={vi.fn()}
      />,
    );

    await user.clear(screen.getByLabelText('Credits'));
    await user.type(screen.getByLabelText('Credits'), '7');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.queryByText(/Step 2/)).toBeNull();
    expect(screen.getByText('Credits must be an integer between 1 and 6.')).toBeInTheDocument();
  });
});
