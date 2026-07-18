/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GroupSetsCard } from './GroupSetsCard';

const { fetchJsonMock } = vi.hoisted(() => ({ fetchJsonMock: vi.fn() }));
vi.mock('@/lib/query-fetch', () => ({ fetchJson: fetchJsonMock }));

// Stub the heavy detail view and create dialog; this test is about the tab shell.
vi.mock('./GroupSetView', () => ({
  GroupSetView: ({ setId }: { setId: string }) => <div data-testid="set-view">view:{setId}</div>,
}));
vi.mock('./CreateGroupSetDialog', () => ({
  CreateGroupSetDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-dialog" /> : null,
}));

const renderCard = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <GroupSetsCard courseId="c1" />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  fetchJsonMock.mockReset();
});

describe('GroupSetsCard', () => {
  it('shows the empty state when the course has no group sets', async () => {
    fetchJsonMock.mockResolvedValue([]);
    renderCard();
    expect(await screen.findByText('No group sets yet')).toBeInTheDocument();
  });

  it('lists group sets and shows the first set by default', async () => {
    fetchJsonMock.mockResolvedValue([
      { id: 'gs1', name: 'Project 1', locked: false, groupCount: 2, assignedCount: 3 },
      { id: 'gs2', name: 'Project 2', locked: false, groupCount: 1, assignedCount: 0 },
    ]);
    renderCard();

    const selector = (await screen.findByLabelText('Group set')) as HTMLSelectElement;
    expect(selector).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Project 1/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Project 2/ })).toBeInTheDocument();

    // The first set is auto-selected and rendered.
    await waitFor(() => expect(screen.getByTestId('set-view')).toHaveTextContent('view:gs1'));
  });
});
