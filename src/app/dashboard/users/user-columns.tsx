'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import type { User } from '@prisma/client';
import { getInitials } from '@/app/utils/initials';
import type { UserListItem } from '@/lib/users-list';

import { Button } from '@/components/ui/button';
import { Badge as StatusBadge } from '@/components/ui/badge';
import { EditUserDialog } from '@/components/dialogs/EditUserDialog';
import { ResetPasswordDialog } from '@/components/dialogs/ResetPasswordDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Pencil, Trash2, Lock, User2, ChevronDown } from 'lucide-react';
import { CompactDate } from '@/components/ui/CompactDate';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

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
        return inactive ? (
          <StatusBadge variant="neutral">Inactive</StatusBadge>
        ) : (
          <StatusBadge variant="success">Active</StatusBadge>
        );
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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
        targetUserName={`${user.firstName} ${user.lastName}`}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete User"
        description={`Are you sure you want to delete ${user.firstName} ${user.lastName}?`}
        confirmText="Delete"
        cancelText="Cancel"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            aria-label={`Manage ${user.firstName} ${user.lastName}`}
            className="inline-flex items-center gap-2"
          >
            Manage
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-50">
          <DropdownMenuLabel className="font-medium">{`${user.firstName} ${user.lastName}`}</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => setEditUserOpen(true)}
            className="hover:bg-secondary flex items-center gap-2"
          >
            <Pencil className="h-4 w-4" />
            Edit User Profile
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setResetOpen(true)}
            className="hover:bg-secondary flex items-center gap-2"
          >
            <Lock className="h-4 w-4" />
            Reset Password
          </DropdownMenuItem>

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
