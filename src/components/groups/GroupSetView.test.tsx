/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GroupSetView } from './GroupSetView';

const { fetchJsonMock } = vi.hoisted(() => ({ fetchJsonMock: vi.fn() }));
vi.mock('@/lib/query-fetch', () => ({ fetchJson: fetchJsonMock }));
vi.mock('@/lib/toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const detail = {
  id: 'gs1',
  name: 'Project 1',
  locked: false,
  basis: 'b0',
  groups: [
    {
      id: 'g1',
      name: 'Group 1',
      members: [
        { id: 'a', firstName: 'Ann', lastName: 'A', email: 'ann@e.com', inactive: false },
        { id: 'b', firstName: 'Bob', lastName: 'B', email: 'bob@e.com', inactive: true },
      ],
    },
  ],
  eligibleStudents: [
    { id: 'a', firstName: 'Ann', lastName: 'A', email: 'ann@e.com' },
    { id: 'c', firstName: 'Cara', lastName: 'C', email: 'cara@e.com' },
  ],
};

const renderView = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <GroupSetView
        courseId="c1"
        setId="gs1"
        suggestedDuplicateName="Project 1 Copy"
        onListChanged={vi.fn()}
        onSelectSet={vi.fn()}
        courseIsArchived={false}
      />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockResolvedValue(detail);
});

describe('GroupSetView', () => {
  it('renders groups, members, an inactive indicator, and the unassigned panel', async () => {
    renderView();
    expect(await screen.findByText('Group 1')).toBeInTheDocument();
    expect(screen.getByText('Ann A')).toBeInTheDocument();
    // Bob is inactive and flagged, not hidden.
    expect(screen.getByText('Bob B')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    // Cara is eligible but unassigned.
    expect(screen.getByText('Cara C')).toBeInTheDocument();
  });

  it('reveals the selection action bar when a student is selected', async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByText('Group 1');
    await user.click(screen.getByLabelText('Select Cara C'));
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /move to/i })).toBeInTheDocument();
  });
});
