/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Moving students between groups.
 *
 * The sibling file covers what the view renders. This one covers what the actions do, which
 * needs the opposite treatment of the Move-to menu: there it only has to exist, here its
 * items have to be clickable.
 *
 * Two things make this worth pinning beyond the happy path. Every membership write carries
 * the basis it read, so a set edited on another screen is refused rather than silently
 * overwriting someone else's grouping; that refusal has its own message and recovery. And a
 * move that would change nothing is dropped before it reaches the server, because once a set
 * is locked by a submission its memberships are frozen and a pointless write would be
 * refused for reasons the operator cannot act on.
 */

const { apiPostMock } = vi.hoisted(() => ({ apiPostMock: vi.fn() }));
const { apiDelMock } = vi.hoisted(() => ({ apiDelMock: vi.fn() }));
const { fetchJsonMock } = vi.hoisted(() => ({ fetchJsonMock: vi.fn() }));
const { toast } = vi.hoisted(() => ({
  // The whole surface the component uses. Omitting `deleted`/`created` makes the call throw
  // inside the handler's try, which the catch then reports as a failure - so the test would
  // pass or fail for reasons that have nothing to do with the code under test.
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

vi.mock('@/lib/query-fetch', () => ({ fetchJson: fetchJsonMock }));
vi.mock('@/lib/toast', () => ({ showToast: toast }));
vi.mock('@/lib/api/fetch-client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api/fetch-client')>('@/lib/api/fetch-client');
  return {
    ...actual,
    apiClient: { post: apiPostMock, patch: vi.fn(), del: apiDelMock, get: vi.fn() },
  };
});

// Render the menu inline so its items can be clicked; Radix drives itself with pointer
// capture and portals that jsdom does not implement.
// Confirm dialogs are portalled alert dialogs; render the confirm as a plain button so
// the destructive handler behind it actually runs.
vi.mock('@/components/dialogs/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    confirmText,
  }: {
    open: boolean;
    onConfirm: () => void | Promise<void>;
    confirmText?: string;
  }) =>
    open ? (
      <button type="button" onClick={() => void onConfirm()}>
        {confirmText}
      </button>
    ) : null,
}));

vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({
      children,
      onClick,
      disabled,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

import { GroupSetView } from './GroupSetView';
import { ApiError } from '@/lib/api/fetch-client';

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
  ],
};

const onListChanged = vi.fn();

const renderView = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <GroupSetView
        courseId="c1"
        setId="gs1"
        suggestedDuplicateName="Project 1 Copy"
        onListChanged={onListChanged}
        onSelectSet={vi.fn()}
        courseIsArchived={false}
      />
    </QueryClientProvider>,
  );
};

/**
 * Click a confirm button by its text. The menu item that opens the dialog carries the same
 * words, so take the later of the two: the dialogs render at the end of the tree.
 */
async function clickConfirm(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await waitFor(() => expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0));
  const matches = screen.getAllByRole('button', { name });
  await user.click(matches[matches.length - 1]);
}

/** Select a student by name, then click one of the action-bar entries. */
async function selectThen(studentLabel: string, action: RegExp) {
  const user = userEvent.setup();
  renderView();
  await screen.findByText('Group 1');
  await user.click(screen.getByLabelText(studentLabel));
  await user.click(await screen.findByRole('button', { name: action }));
  return user;
}

const postedBody = () => apiPostMock.mock.calls[0][1] as { operations: unknown; expectedBasis: string };

beforeEach(() => {
  vi.clearAllMocks();
  fetchJsonMock.mockResolvedValue(detail);
  apiPostMock.mockResolvedValue({ ...detail, basis: 'b1' });
  apiDelMock.mockResolvedValue(undefined);
});

describe('moving students into a group', () => {
  it('sends one operation per student, against the basis it read', async () => {
    // expectedBasis is the optimistic-concurrency token: without it, two staff editing the
    // same set would each overwrite the other's grouping with no warning.
    await selectThen('Select Cara C', /^Group 2$/);

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(1));
    expect(postedBody()).toEqual({
      operations: [{ userId: 'c', groupId: 'g2' }],
      expectedBasis: 'b0',
    });
  });

  it('reports the move and clears the selection', async () => {
    await selectThen('Select Cara C', /^Group 2$/);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Moved 1 to Group 2'));
    // The action bar goes with the selection, so a second click cannot re-send the move.
    await waitFor(() => expect(screen.queryByText('1 selected')).not.toBeInTheDocument());
    expect(onListChanged).toHaveBeenCalled();
  });

  it('drops a move that would change nothing, without asking the server', async () => {
    // Ann is already in Group 1. A locked set refuses membership writes, so sending a
    // no-op would surface an error the operator can do nothing about.
    await selectThen('Select Ann A', /^Group 1$/);

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(apiPostMock).not.toHaveBeenCalled();
  });
});

describe('removing students from their group', () => {
  it('sends a null group for each one', async () => {
    await selectThen('Select Ann A', /remove from group/i);

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(1));
    expect(postedBody().operations).toEqual([{ userId: 'a', groupId: null }]);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Removed 1 from their group'),
    );
  });

  it('says so when the selection is not in a group, rather than sending nothing', async () => {
    // Cara is unassigned, so there is nothing to remove her from.
    await selectThen('Select Cara C', /remove from group/i);

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith('None of the selected students are in a group.'),
    );
    expect(apiPostMock).not.toHaveBeenCalled();
  });
});

describe('when the set changed underneath', () => {
  it('refuses the write and says where to look, rather than overwriting', async () => {
    // The server compares expectedBasis and answers 409. Reporting this as a generic
    // failure would leave the operator thinking their change was lost to a bug.
    apiPostMock.mockRejectedValue(new ApiError('stale', 409, {}));

    await selectThen('Select Cara C', /^Group 2$/);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This group set changed on another screen. Refreshing to the latest groups.',
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('surfaces any other failure with the server’s own message', async () => {
    // Anything that is not the 409 above keeps the server's wording, so a locked set or a
    // dropped student explains itself.
    apiPostMock.mockRejectedValue(new ApiError('This group set is locked.', 423, {}));

    await selectThen('Select Cara C', /^Group 2$/);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This group set is locked.'));
  });

  it('falls back to a generic message when the failure is not an ApiError', async () => {
    apiPostMock.mockRejectedValue(new Error('network down'));

    await selectThen('Select Cara C', /^Group 2$/);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update groups'));
  });
});

describe('deleting', () => {
  const onSelectSet = vi.fn();

  const renderWithSelect = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(
      <QueryClientProvider client={client}>
        <GroupSetView
          courseId="c1"
          setId="gs1"
          suggestedDuplicateName="Project 1 Copy"
          onListChanged={onListChanged}
          onSelectSet={onSelectSet}
          courseIsArchived={false}
        />
      </QueryClientProvider>,
    );
  };

  it('removes a group once confirmed', async () => {
    const user = userEvent.setup();
    renderWithSelect();
    await screen.findByText('Group 1');

    await user.click(screen.getAllByRole('button', { name: /delete group$/i })[0]);
    await clickConfirm(user, /^Delete group$/);

    await waitFor(() =>
      expect(apiDelMock).toHaveBeenCalledWith('/api/courses/c1/group-sets/gs1/groups/g1'),
    );
    expect(onListChanged).toHaveBeenCalled();
    // Reported as a deletion, which is also what proves the handler ran to the end.
    expect(toast.deleted).toHaveBeenCalledWith('Group');
  });

  it('keeps the group and explains why when the server refuses', async () => {
    // A set locked by a submission refuses this, and the reason is the only thing telling
    // the operator that the freeze is deliberate rather than a fault.
    apiDelMock.mockRejectedValue(new ApiError('This group set has submissions.', 409, {}));
    const user = userEvent.setup();
    renderWithSelect();
    await screen.findByText('Group 1');

    await user.click(screen.getAllByRole('button', { name: /delete group$/i })[0]);
    await clickConfirm(user, /^Delete group$/);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('This group set has submissions.'),
    );
  });

  it('deletes the whole set and hands the choice of the next one back', async () => {
    const user = userEvent.setup();
    renderWithSelect();
    await screen.findByText('Group 1');

    await user.click(screen.getByRole('button', { name: /delete set/i }));
    await clickConfirm(user, /^Delete group set$/);

    await waitFor(() => expect(apiDelMock).toHaveBeenCalledWith('/api/courses/c1/group-sets/gs1'));
    // Empty string means "parent, pick whatever is left" rather than pointing at a set
    // that no longer exists.
    await waitFor(() => expect(onSelectSet).toHaveBeenCalledWith(''));
  });

  it('leaves the set selected when its deletion is refused', async () => {
    apiDelMock.mockRejectedValue(new ApiError('This group set is in use.', 409, {}));
    const user = userEvent.setup();
    renderWithSelect();
    await screen.findByText('Group 1');

    await user.click(screen.getByRole('button', { name: /delete set/i }));
    await clickConfirm(user, /^Delete group set$/);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This group set is in use.'));
    expect(onSelectSet).not.toHaveBeenCalled();
  });
});
