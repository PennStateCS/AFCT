/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

const renderView = (courseIsArchived = false) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <GroupSetView
        courseId="c1"
        setId="gs1"
        suggestedDuplicateName="Project 1 Copy"
        onListChanged={vi.fn()}
        onSelectSet={vi.fn()}
        courseIsArchived={courseIsArchived}
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

  it('offers a drag handle for active students but not inactive ones', async () => {
    renderView();
    await screen.findByText('Group 1');
    // Active students (assigned or unassigned) get a handle.
    expect(screen.getByLabelText('Drag Ann A')).toBeInTheDocument();
    expect(screen.getByLabelText('Drag Cara C')).toBeInTheDocument();
    // Bob is inactive, so he can't be dragged.
    expect(screen.queryByLabelText('Drag Bob B')).not.toBeInTheDocument();
  });

  it('hides the drag handles when the course is archived (checkboxes still render)', async () => {
    renderView(true);
    await screen.findByText('Group 1');
    expect(screen.queryByLabelText('Drag Ann A')).not.toBeInTheDocument();
    // The keyboard/AT path (the checkbox) is still present.
    expect(screen.getByLabelText('Select Ann A')).toBeInTheDocument();
  });

  it('reveals the selection action bar when a student is selected', async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByText('Group 1');
    await user.click(screen.getByLabelText('Select Cara C'));
    // "1 selected" appears in both the visible action bar and the sr-only live region.
    await waitFor(() => expect(screen.getAllByText('1 selected').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /move to/i })).toBeInTheDocument();
  });
});
