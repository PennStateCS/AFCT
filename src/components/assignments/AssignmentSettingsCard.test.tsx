/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { Assignment } from '@prisma/client';

import { AssignmentSettingsCard } from './AssignmentSettingsCard';

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showToast: { success: toastSuccessMock, error: toastErrorMock },
}));

const assignment = {
  id: 'a1',
  title: 'Original',
  description: 'Desc',
  dueDate: new Date('2026-09-01T23:59:00Z'),
  unlockAt: null,
  assignedToEveryone: true,
  isPublished: false,
  isGroup: false,
  allowLateSubmissions: false,
  lateCutoff: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  courseId: 'c1',
} as unknown as Assignment;

const originalFetch = global.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('AssignmentSettingsCard', () => {
  it('disables Save until a field changes, then PUTs and toasts success', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ...assignment, title: 'New title' }) });
    const onSaved = vi.fn();

    render(
      <AssignmentSettingsCard
        courseId="c1"
        assignment={assignment}
        timeZone="UTC"
        courseIsArchived={false}
        onSaved={onSaved}
      />,
    );

    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();

    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'New title');

    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/courses/c1/assignments/a1');
    expect((init as RequestInit).method).toBe('PUT');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ title: 'New title', unlockAt: null, lateCutoff: null });

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Assignment settings saved'));
    expect(onSaved).toHaveBeenCalled();
  });

  it('disables Save when the course is archived', () => {
    render(
      <AssignmentSettingsCard
        courseId="c1"
        assignment={assignment}
        timeZone="UTC"
        courseIsArchived
      />,
    );
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });
});
