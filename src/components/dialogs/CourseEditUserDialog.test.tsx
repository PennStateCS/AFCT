/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import CourseEditUserDialog from './CourseEditUserDialog';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
vi.mock('@/components/ui/select', () => import('@/test/mocks/ui').then((mod) => mod.selectMock));

const { showToastSuccess, showToastError } = vi.hoisted(() => ({
  showToastSuccess: vi.fn(),
  showToastError: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showToast: {
    success: showToastSuccess,
    error: showToastError,
  },
}));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const originalFetch = global.fetch;
const fetchMock = vi.fn();

const baseRoster = {
  id: 'r1',
  role: 'STUDENT',
  user: {
    id: 'u1',
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    avatar: null,
  },
};

describe('CourseEditUserDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    showToastSuccess.mockReset();
    showToastError.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('updates the roster role', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onSaved = vi.fn();

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Response);

    renderWithClient(
      <CourseEditUserDialog
        open
        setOpen={setOpen}
        courseId="c1"
        userId="u1"
        onSaved={onSaved}
        initialRoster={baseRoster}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Faculty' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(requestInit.body as string)).toEqual({ role: 'FACULTY' });

    expect(onSaved).toHaveBeenCalled();
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(showToastSuccess).toHaveBeenCalledWith('Roster updated');
  });

  it('shows an error toast when saving fails', async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();

    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'nope' }),
    } as Response);

    renderWithClient(
      <CourseEditUserDialog
        open
        setOpen={setOpen}
        courseId="c1"
        userId="u1"
        initialRoster={baseRoster}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Faculty' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(showToastError).toHaveBeenCalledWith('nope'));
    expect(setOpen).not.toHaveBeenCalledWith(false);
  });
});
