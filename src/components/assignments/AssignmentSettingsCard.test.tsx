/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Assignment } from '@prisma/client';

import { AssignmentSettingsCard } from './AssignmentSettingsCard';

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showToast: { success: toastSuccessMock, error: toastErrorMock, warning: vi.fn() },
}));

// The Assign-To section is covered by the wizard test; stub it here.
vi.mock('@/components/assignments/AssignToFields', () => ({
  AssignToFields: () => <div data-testid="assign-to" />,
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
const ok = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
  text: async () => JSON.stringify(data),
});
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const u = String(url);
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'GET' && u.includes('/overrides')) return ok([]) as unknown as Response;
  if (method === 'PUT' && u.includes('/assignments/a1')) {
    return ok({ ...assignment, title: 'New title' }) as unknown as Response;
  }
  throw new Error(`Unexpected fetch: ${method} ${u}`);
});

const renderCard = (props: Partial<React.ComponentProps<typeof AssignmentSettingsCard>> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <AssignmentSettingsCard
        courseId="c1"
        assignment={assignment}
        timeZone="UTC"
        courseIsArchived={false}
        onSaved={onSaved}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onSaved };
};

beforeEach(() => {
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('AssignmentSettingsCard', () => {
  it('disables Save until a field changes, then PUTs the base fields and toasts success', async () => {
    const user = userEvent.setup();
    const { onSaved } = renderCard();

    // Wait for the overrides query to settle so the form is seeded.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await screen.findByTestId('assign-to');

    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();

    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'New title');
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'PUT',
      );
      expect(put).toBeTruthy();
    });
    const put = fetchMock.mock.calls.find(
      ([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'PUT',
    )!;
    expect(String(put[0])).toBe('/api/courses/c1/assignments/a1');
    const body = JSON.parse((put[1] as RequestInit).body as string);
    expect(body).toMatchObject({ title: 'New title', assignedToEveryone: true, lateCutoff: null });

    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Assignment settings saved'));
    expect(onSaved).toHaveBeenCalled();
  });

  it('disables Save when the course is archived', async () => {
    renderCard({ courseIsArchived: true });
    await screen.findByTestId('assign-to');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });
});
