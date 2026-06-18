'use client';

import { ColumnDef } from '@tanstack/react-table';
import { roleSortingFn } from '@/lib/roles';
import { useState } from 'react';
import { User } from '@prisma/client';
import type { UserListItem } from '@/lib/users-list';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/RoleBadge';
import { Badge as StatusBadge } from '@/components/ui/badge';
import { EditUserDialog } from '@/components/dialogs/EditUserDialog';
import { AdminResetPasswordDialog } from '@/components/dialogs/AdminResetPasswordDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Pencil, Trash2, Lock, User2, ChevronDown } from 'lucide-react';
import { formatDateTimeInTimeZone } from '@/lib/date';

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
        const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase();
        return (
          <Avatar className="h-12 w-12">
            <AvatarImage
              src={
                user.avatar
                  ? `/api/uploads/pfps/${user.avatar}`
                  : `/api/uploads/pfps/default-avatar.png`
              }
              alt={`${user.firstName} ${user.lastName}`}
            />
            <AvatarFallback className="bg-secondary text-secondary-foreground">
              {initials || 'U'}
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
      accessorKey: 'role',
      header: 'Role',
      meta: { priority: 3 },
      cell: ({ row }) => <Badge role={row.original.role} className="w-20" />,
      sortingFn: roleSortingFn,
    },
    {
      accessorKey: 'inactive',
      header: 'Status',
      meta: { priority: 4 },
      cell: ({ row }) => {
        const inactive = row.getValue<boolean>('inactive');
        return inactive
          ? <StatusBadge variant="neutral">Inactive</StatusBadge>
          : <StatusBadge variant="success">Active</StatusBadge>;
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Created At',
      meta: { priority: 4 },
      cell: ({ row }) => {
        return formatDateTimeInTimeZone(row.original.createdAt, timeZone);
      },
    },
    {
      accessorKey: 'temporaryPassword',
      header: 'Password Status',
      meta: { priority: 3 },
      cell: ({ row }) => {
        const temporaryPassword = row.getValue<boolean>('temporaryPassword');
        return temporaryPassword
          ? <StatusBadge variant="warning">Temporary</StatusBadge>
          : <StatusBadge variant="neutral">Normal</StatusBadge>;
      },
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
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handlePasswordReset(newPassword: string, isTemporary: boolean) {
    try {
      const res = await fetch('/api/admin/reset-password', {
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
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const body = await res.json();
        const errorMsg = body?.error || 'Unexpected Error: Failed to delete user';

        showToast.error(errorMsg);
        return;
      }

      showToast.success('User deleted successfully.');
      setConfirmOpen(false);
      onUserUpdate();
    } catch (err) {
      showToast.error('Unexpected Error: Failed to delete user');
    }
  }

  return (
    <>
      <EditUserDialog
        user={user as unknown as User}
        open={editOpen}
        setOpen={setEditOpen}
        onSave={async () => {
          onUserUpdate();
        }}
      />

      <AdminResetPasswordDialog
        open={resetOpen}
        setOpen={setResetOpen}
        onResetPassword={handlePasswordReset}
        targetUserName={`${user.firstName} ${user.lastName}`}
      />

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Delete User"
        description={`Are you sure you want to delete ${user.firstName} ${user.lastName}?`}
        confirmText="Delete"
        cancelText="Cancel"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            <ChevronDown />
            Manage
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-50">
          <DropdownMenuLabel className="flex items-center gap-2">
            <User2 className="h-4 w-4" />
            {user.firstName} {user.lastName}
          </DropdownMenuLabel>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => setEditOpen(true)}
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
            onClick={() => setConfirmOpen(true)}
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
