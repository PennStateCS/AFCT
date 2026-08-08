/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Randomly assigning students to groups.
 *
 * Two things make this worth pinning beyond the happy path. It is a two-step flow - preview,
 * then apply - and the preview is a plan built against a basis, so a set edited in between
 * has to be refused rather than applied against groups that have moved. And the default
 * selection is what most staff will accept without reading it, so "active students who are
 * not already in a group" needs to actually be that.
 */

const { apiPostMock } = vi.hoisted(() => ({ apiPostMock: vi.fn() }));
const { toast } = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    created: vi.fn(),
    updated: vi.fn(),
    deleted: vi.fn(),
  },
}));

vi.mock('@/lib/toast', () => ({ showToast: toast }));
vi.mock('@/lib/api/fetch-client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api/fetch-client')>('@/lib/api/fetch-client');
  return { ...actual, apiClient: { post: apiPostMock, patch: vi.fn(), del: vi.fn(), get: vi.fn() } };
});
vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((m) => m.dialogMock));

import { RandomAssignDialog } from './RandomAssignDialog';
import { ApiError } from '@/lib/api/fetch-client';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

// Ann is already in a group, Bob is in one but inactive, Cara and Dan are unassigned.
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
    { id: 'g2', name: 'Group 2', members: [] },
  ],
  eligibleStudents: [
    { id: 'a', firstName: 'Ann', lastName: 'A', email: 'ann@e.com' },
    { id: 'c', firstName: 'Cara', lastName: 'C', email: 'cara@e.com' },
    { id: 'd', firstName: 'Dan', lastName: 'D', email: 'dan@e.com' },
  ],
};

// The whole RandomAssignPreview shape. The render reads placedCount and skippedInactive
// directly, so omitting them does not fail an assertion, it throws while rendering.
const member = (id: string, first: string, last: string) => ({
  id,
  firstName: first,
  lastName: last,
  email: `${first.toLowerCase()}@e.com`,
  inactive: false,
});

const previewResult = {
  basis: 'b0',
  placedCount: 2,
  skippedInactive: [],
  operations: [
    { userId: 'c', groupId: 'g2' },
    { userId: 'd', groupId: 'g2' },
  ],
  groups: [
    { id: 'g1', name: 'Group 1', members: [member('a', 'Ann', 'A')] },
    { id: 'g2', name: 'Group 2', members: [member('c', 'Cara', 'C'), member('d', 'Dan', 'D')] },
  ],
};

const setOpen = vi.fn();
const onApplied = vi.fn();

const renderDialog = () =>
  render(
    <RandomAssignDialog
      open
      setOpen={setOpen}
      courseId="c1"
      detail={detail as never}
      onApplied={onApplied}
    />,
  );

/** Body of the nth POST. */
const posted = (n = 0) => apiPostMock.mock.calls[n][1] as Record<string, unknown>;

/** Run the preview step and wait for it to land. */
async function toPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply assignment' })).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  apiPostMock.mockResolvedValue(previewResult);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('choosing who to assign', () => {
  it('defaults to the active students who are not already in a group', async () => {
    // Ann is assigned so she is off; Bob is inactive so he is not offered at all.
    renderDialog();

    expect(screen.getByLabelText('Include Cara C')).toBeChecked();
    expect(screen.getByLabelText('Include Dan D')).toBeChecked();
    expect(screen.getByLabelText('Include Ann A')).not.toBeChecked();
    expect(screen.queryByLabelText('Include Bob B')).not.toBeInTheDocument();
  });

  it('sends exactly the ticked students', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByLabelText('Include Dan D'));
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalled());
    expect(posted().studentIds).toEqual(['c']);
    expect(posted().reassignSelected).toBe(false);
  });

  it('select all takes everyone offered, clear takes none', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Select all active students' }));
    expect(screen.getByLabelText('Include Ann A')).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Include Cara C')).not.toBeChecked();
  });

  it('filters the list by name or email without changing the selection', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Search students'), 'cara@');

    expect(screen.getByLabelText('Include Cara C')).toBeInTheDocument();
    expect(screen.queryByLabelText('Include Dan D')).not.toBeInTheDocument();

    // Dan is filtered out of view, not deselected: clearing the search brings him back ticked.
    await user.clear(screen.getByLabelText('Search students'));
    expect(screen.getByLabelText('Include Dan D')).toBeChecked();
  });

  it('says so when a search matches nobody', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Search students'), 'zzz');

    expect(screen.getByText('No students match your search.')).toBeInTheDocument();
  });

  it('passes the reassign choice through, so an assigned student can be moved', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(
      screen.getByLabelText('Reassign selected students who are already in a group'),
    );
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalled());
    expect(posted().reassignSelected).toBe(true);
  });

  it('reports a preview failure instead of showing an empty plan', async () => {
    apiPostMock.mockRejectedValue(new ApiError('This group set is locked.', 409, {}));
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText('This group set is locked.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply assignment' })).not.toBeInTheDocument();
  });
});

describe('applying the plan', () => {
  it('sends the previewed operations against the basis they were built from', async () => {
    // The basis comes from the preview, not from the set: applying a plan built against
    // older groups is the thing the server needs to be able to refuse.
    const user = userEvent.setup();
    renderDialog();
    await toPreview(user);

    await user.click(screen.getByRole('button', { name: 'Apply assignment' }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(2));
    expect(posted(1)).toEqual({ operations: previewResult.operations, expectedBasis: 'b0' });
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Students assigned');
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('just closes when the plan would change nothing', async () => {
    apiPostMock.mockResolvedValue({ ...previewResult, operations: [], placedCount: 0 });
    const user = userEvent.setup();
    renderDialog();
    await toPreview(user);

    await user.click(screen.getByRole('button', { name: 'Apply assignment' }));

    // No second request: there is nothing to write.
    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(setOpen).toHaveBeenCalledWith(false);
  });

  it('refuses a plan built against groups that have since moved, and drops it', async () => {
    const user = userEvent.setup();
    renderDialog();
    await toPreview(user);
    apiPostMock.mockRejectedValue(new ApiError('stale', 409, {}));

    await user.click(screen.getByRole('button', { name: 'Apply assignment' }));

    expect(await screen.findByText(/changed while the preview was open/i)).toBeInTheDocument();
    // Back to the picker: applying the same stale plan again must not be one click away.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Apply assignment' })).not.toBeInTheDocument(),
    );
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('keeps the plan on an ordinary failure, so it can be retried', async () => {
    const user = userEvent.setup();
    renderDialog();
    await toPreview(user);
    apiPostMock.mockRejectedValue(new ApiError('Something went wrong.', 500, {}));

    await user.click(screen.getByRole('button', { name: 'Apply assignment' }));

    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply assignment' })).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('goes back to the picker without applying anything', async () => {
    const user = userEvent.setup();
    renderDialog();
    await toPreview(user);

    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByLabelText('Search students')).toBeInTheDocument();
    expect(apiPostMock).toHaveBeenCalledTimes(1);
  });
});
