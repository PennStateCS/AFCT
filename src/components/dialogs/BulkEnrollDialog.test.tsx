/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import BulkEnrollDialog from './BulkEnrollDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const originalFetch = global.fetch;
const fetchMock = vi.fn();
const originalAlert = window.alert;

describe('BulkEnrollDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    window.alert = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.alert = originalAlert;
  });

  it('looks up users and enrolls matches', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onComplete = vi.fn();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        found: [
          {
            id: 'u1',
            firstName: 'Test',
            lastName: 'User',
            email: 'test@example.com',
            role: 'STUDENT',
          },
        ],
        notFound: ['missing@example.com'],
      }),
    } as Response);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    render(
      <BulkEnrollDialog
        open
        setOpen={setOpen}
        courseId="c1"
        courseIsArchived={false}
        onComplete={onComplete}
      />,
    );

    await user.type(
      screen.getByLabelText('Paste emails (one per line or comma-separated)'),
      'test@example.com',
    );

    const nextButton = screen.getByRole('button', { name: 'Next' });
    await user.click(nextButton);

    await waitFor(() => expect(screen.getByText('Matched users (1)')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^enroll/i }));

    await waitFor(() => expect(screen.getByText('Enrollment complete')).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/courses/c1/roster/bulk');
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(secondInit).toMatchObject({ method: 'POST' });
    expect(JSON.parse(secondInit.body as string)).toEqual({ userIds: ['u1'] });
    expect(onComplete).toHaveBeenCalled();
  });

  it('disables lookup when the course is archived', async () => {
    const user = userEvent.setup();

    render(
      <BulkEnrollDialog
        open
        setOpen={vi.fn()}
        courseId="c1"
        courseIsArchived
        onComplete={vi.fn()}
      />,
    );

    await user.type(
      screen.getByLabelText('Paste emails (one per line or comma-separated)'),
      'test@example.com',
    );

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
