/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { GrantExtraSubmissionsDialog } from './GrantExtraSubmissionsDialog';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));

const { showToastSuccess, showToastError } = vi.hoisted(() => ({
  showToastSuccess: vi.fn(),
  showToastError: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showToast: { success: showToastSuccess, error: showToastError },
}));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const originalFetch = global.fetch;
const fetchMock = vi.fn();

const baseProps = {
  open: true,
  setOpen: vi.fn(),
  courseId: 'c1',
  assignmentId: 'a1',
  problemId: 'p1',
  problemTitle: 'DFA warmup',
  student: { id: 'stu-1', name: 'Grace Hopper' },
  groupId: null,
};

describe('GrantExtraSubmissionsDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    showToastSuccess.mockReset();
    showToastError.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    // The grants list read; individual grant tests override the POST response. apiFetch
    // parses success bodies via text(), so the mock must provide it.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
      text: async () => '[]',
    } as unknown as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('grants to the student on an individual assignment', async () => {
    const user = userEvent.setup();
    const onGranted = vi.fn();
    renderWithClient(<GrantExtraSubmissionsDialog {...baseProps} onGranted={onGranted} />);

    await user.click(screen.getByRole('button', { name: 'Grant' }));

    await waitFor(() => expect(showToastSuccess).toHaveBeenCalled());
    const postCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST');
    expect(postCall?.[0]).toBe('/api/courses/c1/assignments/a1/problems/p1/grants');
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toEqual({
      userId: 'stu-1',
      extraSubmissions: 1,
    });
    expect(onGranted).toHaveBeenCalled();
  });

  it('defaults to the whole group on a group assignment', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <GrantExtraSubmissionsDialog {...baseProps} groupId="grp-1" groupName="Team Rocket" />,
    );

    // Both radio targets are offered; the group is preselected.
    expect(screen.getByLabelText(/whole group/i)).toBeChecked();
    expect(screen.getByLabelText(/Only Grace Hopper/i)).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Grant' }));

    await waitFor(() => expect(showToastSuccess).toHaveBeenCalled());
    const postCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST');
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toEqual({
      groupId: 'grp-1',
      extraSubmissions: 1,
    });
  });

  it('rejects a non-positive amount before calling the API', async () => {
    const user = userEvent.setup();
    renderWithClient(<GrantExtraSubmissionsDialog {...baseProps} />);

    const amount = screen.getByLabelText('Extra submissions');
    await user.clear(amount);
    await user.type(amount, '0');
    await user.click(screen.getByRole('button', { name: 'Grant' }));

    expect(showToastError).toHaveBeenCalled();
    const postCall = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST');
    expect(postCall).toBeUndefined();
  });

  it('surfaces the API error message on failure', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (_url, init) => {
      if ((init as RequestInit)?.method === 'POST') {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'That student is not assigned this assignment.' }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => [] } as Response;
    });
    renderWithClient(<GrantExtraSubmissionsDialog {...baseProps} />);

    await user.click(screen.getByRole('button', { name: 'Grant' }));

    await waitFor(() =>
      expect(showToastError).toHaveBeenCalledWith('That student is not assigned this assignment.'),
    );
  });
});
