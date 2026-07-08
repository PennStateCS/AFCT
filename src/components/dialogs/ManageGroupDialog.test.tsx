/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ManageGroupMembersDialog from './ManageGroupDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));

vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn() },
}));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

const originalFetch = global.fetch;
const fetchMock = vi.fn();

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ManageGroupMembersDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('loads students and seeds member selection from the queries', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/students')) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            { id: 's1', firstName: 'Ann', lastName: 'Aardvark', email: 'ann@x.edu' },
            { id: 's2', firstName: 'Bob', lastName: 'Beetle', email: 'bob@x.edu' },
          ],
        } as Response);
      }
      if (url.endsWith('/members')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ members: [{ userId: 's2' }] }),
        } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    renderWithClient(
      <ManageGroupMembersDialog
        open
        setOpen={vi.fn()}
        courseId="c1"
        group={{ id: 'g1', name: 'Team' }}
      />,
    );

    await waitFor(() => expect(screen.getByText('Ann Aardvark')).toBeTruthy());
    expect(screen.getByText('Bob Beetle')).toBeTruthy();

    const annBox = document.getElementById('manage-checkbox-s1') as HTMLInputElement;
    const bobBox = document.getElementById('manage-checkbox-s2') as HTMLInputElement;
    expect(annBox.checked).toBe(false);
    expect(bobBox.checked).toBe(true);
  });
});
