'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import type { User } from '@prisma/client';
import { getInitials } from '@/app/utils/initials';
import type { UserListItem } from '@/lib/users-list';

import { Button } from '@/components/ui/button';
import { Badge as StatusBadge } from '@/components/ui/badge';
import { EditUserDialog } from '@/components/dialogs/EditUserDialog';
import { ResetPasswordDialog } from '@/components/dialogs/ResetPasswordDialog';
import { ChangeUserEmailDialog } from '@/components/dialogs/ChangeUserEmailDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Pencil, Trash2, Lock, LockOpen, ChevronDown, Mail, UserX, UserCheck } from 'lucide-react';
import { CompactDate } from '@/components/ui/CompactDate';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

/** Human "5m", "40s" for a millisecond duration. Coarse on purpose; this is a hint. */
function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds >= 60) return `${Math.ceil(totalSeconds / 60)}m`;
  return `${totalSeconds}s`;
}

/**
 * "Locked 5m" badge that counts itself down and disappears when the lock expires -
 * without a refetch, so the table stays honest as the clock runs. Renders nothing once
 * the lock is in the past or absent.
 */
function LockedBadge({ lockedUntil }: { lockedUntil: Date | string | null }) {
  const target = lockedUntil ? new Date(lockedUntil).getTime() : 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target || target <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  const remaining = target - now;
  if (remaining <= 0) return null;

  return (
    <StatusBadge variant="warning" title={new Date(target).toLocaleString()}>
      <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
      Locked {formatRemaining(remaining)}
    </StatusBadge>
  );
}

/** Whether an account is locked right now (future lockedUntil). */
function isLockedNow(lockedUntil: Date | string | null): boolean {
  return Boolean(lockedUntil && new Date(lockedUntil).getTime() > Date.now());
}

export function getUserColumns(
  onUserUpdate: () => void,
  timeZone: string,
): ColumnDef<UserListItem>[] {
  return [
    {
      id: 'avatar',
      header: 'Avatar',
      meta: { priority: 4 },
      cell: ({ row }) => {
        const user = row.original;
        return (
          <Avatar className="h-12 w-12">
            <AvatarImage
              src={user.avatar ? apiPaths.files.pfp(user.avatar) : undefined}
              alt={`${user.firstName} ${user.lastName}`}
              cropX={user.cropX ?? 0.5}
              cropY={user.cropY ?? 0.5}
              zoom={user.zoom ?? 1}
            />
            <AvatarFallback className="bg-secondary text-secondary-foreground">
              {getInitials(user.firstName, user.lastName, user.email)}
            </AvatarFallback>
          </Avatar>
        );
      },
    },
    {
      accessorKey: 'firstName',
      header: 'First Name',
      meta: { priority: 1 },
    },
    {
      accessorKey: 'lastName',
      header: 'Last Name',
      meta: { priority: 1 },
    },
    {
      accessorKey: 'email',
      header: 'Email',
      meta: { priority: 2 },
      cell: ({ row }) => {
        const email = row.getValue<string>('email');
        return (
          <a href={`mailto:${email}`} className="text-blue-600 hover:underline">
            {email}
          </a>
        );
      },
    },
    {
      accessorKey: 'isAdmin',
      header: 'Admin',
      meta: {
        priority: 3,
        filterVariant: 'multiselect',
        filterLabel: 'Admin',
        filterOptions: [
          { label: 'Admin', value: 'true' },
          { label: 'Standard', value: 'false' },
        ],
      },
      cell: ({ row }) =>
        row.original.isAdmin ? (
          <StatusBadge variant="success">Admin</StatusBadge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: 'inactive',
      header: 'Status',
      meta: {
        priority: 4,
        filterVariant: 'multiselect',
        filterLabel: 'Status',
        filterOptions: [
          { label: 'Active', value: 'false' },
          { label: 'Inactive', value: 'true' },
        ],
      },
      cell: ({ row }) => {
        const inactive = row.getValue<boolean>('inactive');
        if (inactive) return <StatusBadge variant="neutral">Inactive</StatusBadge>;
        // A live lock outranks "Active": a locked account can't sign in right now, which
        // is what an admin scanning this column needs to see. Expired/null falls through.
        return (
          <span className="flex items-center gap-1.5">
            <StatusBadge variant="success">Active</StatusBadge>
            <LockedBadge lockedUntil={row.original.lockedUntil} />
          </span>
        );
      },
    },
    {
      // Filter-only, hidden by default (see defaultColumnVisibility in UsersClient).
      // Lock is orthogonal to Active/Inactive - a user can be active AND locked - so it
      // gets its own filter dimension rather than being folded into the Status filter,
      // which would wrongly make "Active" and "Locked" mutually exclusive.
      id: 'lockStatus',
      accessorFn: (row) => (isLockedNow(row.lockedUntil) ? 'locked' : 'unlocked'),
      header: () => <span className="sr-only">Lock status</span>,
      cell: () => null,
      meta: {
        filterVariant: 'multiselect',
        filterLabel: 'Lock',
        filterOptions: [
          { label: 'Locked', value: 'locked' },
          { label: 'Not locked', value: 'unlocked' },
        ],
      },
    },
    {
      accessorKey: 'temporaryPassword',
      header: 'Password Status',
      meta: {
        priority: 3,
        filterVariant: 'multiselect',
        filterLabel: 'Password Status',
        filterOptions: [
          { label: 'Temporary', value: 'true' },
          { label: 'Normal', value: 'false' },
        ],
      },
      cell: ({ row }) => {
        const temporaryPassword = row.getValue<boolean>('temporaryPassword');
        return temporaryPassword ? (
          <StatusBadge variant="warning">Temporary</StatusBadge>
        ) : (
          <StatusBadge variant="neutral">Normal</StatusBadge>
        );
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Created At',
      meta: { priority: 4 },
      cell: ({ row }) => <CompactDate value={row.original.createdAt} timeZone={timeZone} />,
    },
    {
      accessorKey: 'lastLogin',
      header: 'Last Login',
      meta: { priority: 3 },
      cell: ({ row }) => <CompactDate value={row.original.lastLogin} timeZone={timeZone} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      meta: { priority: 1 },
      cell: ({ row }) => {
        const user = row.original;
        return <UserActionsCell user={user} onUserUpdate={onUserUpdate} />;
      },
    },
  ];
}

// Extract the cell component to fix React hooks violation
function UserActionsCell({ user, onUserUpdate }: { user: UserListItem; onUserUpdate: () => void }) {
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [ unlockConfirmOpen, setUnlockConfirmOpen ] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [changeEmailOpen, setChangeEmailOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);

  const fullName = `${user.firstName} ${user.lastName}`;

  // Flip the account's active status. The route enforces admin-only, blocks
  // deactivating the last active admin or a user still on a live course, and clears
  // their session; surface whatever it rejects with.
  async function handleStatusChange(inactive: boolean) {
    try {
      const res = await fetch(apiPaths.user(user.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inactive }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to update account status.');
      }
      showToast.success(inactive ? 'Account deactivated.' : 'Account reactivated.');
      setDeactivateOpen(false);
      setReactivateOpen(false);
      onUserUpdate();
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : 'Failed to update account status.');
    }
  }

  async function handlePasswordReset(newPassword: string, isTemporary: boolean) {
    try {
      const res = await fetch(apiPaths.admin.resetPassword(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, newPassword, isTemporary }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to reset password.');
      }

      setResetOpen(false);
      onUserUpdate();
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : 'Failed to reset password.');
    }
  }

  async function handleUnlock() {
    try {
      const res = await fetch(apiPaths.admin.unlockAccount(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to unlock account.');
      }
      showToast.success('Account unlocked.');
      setUnlockConfirmOpen(false);
      onUserUpdate();
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : 'Failed to unlock account.');
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(apiPaths.user(user.id), {
        method: 'DELETE',
      });

      if (!res.ok) {
        const body = await res.json();
        const errorMsg = body?.error || 'Unexpected Error: Failed to delete user';

        showToast.error(errorMsg);
        return;
      }

      showToast.success('User deleted successfully.');
      setConfirmDeleteOpen(false);
      onUserUpdate();
    } catch {
      showToast.error('Unexpected Error: Failed to delete user');
    }
  }

  // The safe (non-destructive) actions, alphabetized by their visible label so the menu
  // order stays predictable. The account-status item swaps between Deactivate and
  // Reactivate depending on the current state; only one is ever shown. Delete is
  // deliberately kept out of this list and pinned at the bottom in its red group.
  const statusItem = user.inactive
    ? {
        label: 'Reactivate Account',
        node: (
          <DropdownMenuItem
            key="status"
            onClick={() => setReactivateOpen(true)}
            className="hover:bg-secondary flex items-center gap-2"
          >
            <UserCheck className="h-4 w-4" />
            Reactivate Account
          </DropdownMenuItem>
        ),
      }
    : {
        label: 'Deactivate Account',
        node: (
          <DropdownMenuItem
            key="status"
            onClick={() => setDeactivateOpen(true)}
            className="hover:bg-secondary flex items-center gap-2"
          >
            <UserX className="h-4 w-4" />
            Deactivate Account
          </DropdownMenuItem>
        ),
      };

  const safeItems = [
    {
      label: 'Change Email Address',
      node: (
        <DropdownMenuItem
          key="email"
          onClick={() => setChangeEmailOpen(true)}
          className="hover:bg-secondary flex items-center gap-2"
        >
          <Mail className="h-4 w-4" />
          Change Email Address
        </DropdownMenuItem>
      ),
    },
    statusItem,
    {
      label: 'Edit User Profile',
      node: (
        <DropdownMenuItem
          key="edit"
          onClick={() => setEditUserOpen(true)}
          className="hover:bg-secondary flex items-center gap-2"
        >
          <Pencil className="h-4 w-4" />
          Edit User Profile
        </DropdownMenuItem>
      ),
    },
    {
      label: 'Reset Password',
      node: (
        <DropdownMenuItem
          key="reset"
          onClick={() => setResetOpen(true)}
          className="hover:bg-secondary flex items-center gap-2"
        >
          <Lock className="h-4 w-4" />
          Reset Password
        </DropdownMenuItem>
      ),
    },
    {
      label: 'Unlock Account',
      node: (
        <DropdownMenuItem
          key="unlock"
          onClick={() => setUnlockConfirmOpen(true)}
          disabled={!isLockedNow(user.lockedUntil)}
          className="hover:bg-secondary flex items-center gap-2"
        >
          <LockOpen className="h-4 w-4" />
          Unlock Account
        </DropdownMenuItem>
      ),
    },
  ].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <EditUserDialog
        user={user as unknown as User}
        open={editUserOpen}
        setOpen={setEditUserOpen}
        onSave={async () => {
          onUserUpdate();
        }}
      />

      <ResetPasswordDialog
        open={resetOpen}
        setOpen={setResetOpen}
        onResetPassword={handlePasswordReset}
        targetUserName={fullName}
      />

      <ChangeUserEmailDialog
        open={changeEmailOpen}
        setOpen={setChangeEmailOpen}
        userId={user.id}
        currentEmail={user.email}
        userName={fullName}
        onChanged={onUserUpdate}
      />

      <ConfirmDialog
        open={deactivateOpen}
        onCancel={() => setDeactivateOpen(false)}
        onConfirm={() => handleStatusChange(true)}
        title="Deactivate Account"
        description={`Deactivate ${fullName}? They will no longer be able to sign in to AFCT. You can reactivate the account later.`}
        confirmText="Deactivate"
        cancelText="Cancel"
      />

      <ConfirmDialog
        open={reactivateOpen}
        onCancel={() => setReactivateOpen(false)}
        onConfirm={() => handleStatusChange(false)}
        title="Reactivate Account"
        description={`Reactivate ${fullName}? They will be able to sign in again.`}
        confirmText="Reactivate"
        cancelText="Cancel"
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete User"
        description={`Are you sure you want to delete ${fullName}?`}
        confirmText="Delete"
        cancelText="Cancel"
      />

      <ConfirmDialog
        open={unlockConfirmOpen}
        onCancel={() => setUnlockConfirmOpen(false)}
        onConfirm={handleUnlock}
        title="Unlock Account"
        description={`Unlock ${fullName}? They will be able to sign in again immediately. Repeated failed logins can re-lock the account.`}
        confirmText="Unlock"
        cancelText="Cancel"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            aria-label={`Manage user ${fullName}`}
            className="inline-flex items-center gap-2"
          >
            Manage
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel className="font-medium">{fullName}</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {safeItems.map((item) => item.node)}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={!user.inactive}
            className="hover:bg-secondary flex items-center gap-2 text-red-600 focus:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
            Delete Inactive User
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
