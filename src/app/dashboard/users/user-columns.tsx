'use client';

import { ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import { format } from 'date-fns';
import { User } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/RoleBadge';
import { EditUserDialog } from '@/components/dialogs/EditUserDialog';
import { AdminResetPasswordDialog } from '@/components/dialogs/AdminResetPasswordDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Pencil, Trash2, Lock, User2, ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export function getUserColumns(onUserUpdate: () => void): ColumnDef<User>[] {
  function formatRole(role: string): string {
    switch (role) {
      case 'STUDENT':
        return 'Student';
      case 'FACULTY':
        return 'Faculty';
      case 'TA':
        return 'TA';
      case 'ADMIN':
        return 'Admin';
      default:
        return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
    }
  }

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
              src={user.avatar ? `/uploads/${user.avatar}` : undefined}
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
      cell: ({ row }) => <Badge role={row.original.role}>{formatRole(row.original.role)}</Badge>,
    },
    {
      accessorKey: 'inactive',
      header: 'Active',
      meta: { priority: 4 },
      cell: ({ row }) => {
        const inactive = row.getValue<boolean>('inactive');
        return inactive ? 'No' : 'Yes';
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Created At',
      meta: { priority: 4 },
      cell: ({ row }) => {
        const date = new Date(row.original.createdAt);
        return format(date, "M/d/yyyy 'at' p");
      },
    },
    {
      id: 'actions',
      header: '',
      meta: { priority: 1 },
      cell: ({ row }) => {
        const user = row.original;
        return <UserActionsCell user={user} onUserUpdate={onUserUpdate} />;
      },
    },
  ];
}

// Extract the cell component to fix React hooks violation
function UserActionsCell({ user, onUserUpdate }: { user: User; onUserUpdate: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handlePasswordReset(newPassword: string) {
    try {
      await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, newPassword }),
      });
      showToast.success('Password reset successfully.');
      setResetOpen(false);
    } catch {
      showToast.error('Failed to reset password.');
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Delete failed');

      showToast.success('User deleted successfully.');
      setConfirmOpen(false);
      onUserUpdate();
    } catch {
      showToast.error('Failed to delete user.');
    }
  }

  return (
    <>
      <EditUserDialog
        user={user}
        open={editOpen}
        setOpen={setEditOpen}
        onSave={async (updatedUser) => {
          try {
            const res = await fetch(`/api/users/${updatedUser.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updatedUser),
            });
            if (!res.ok) throw new Error();
            showToast.success('User updated successfully.');
            setEditOpen(false);
            onUserUpdate();
          } catch {
            showToast.error('Failed to update user.');
          }
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
            className="hover:bg-secondary focus:bg-secondary focus:text-secondary-foreground flex items-center gap-2"
          >
            <Pencil className="h-4 w-4" />
            Edit User Profile
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => setResetOpen(true)}
            className="hover:bg-secondary focus:bg-secondary focus:text-secondary-foreground flex items-center gap-2"
          >
            <Lock className="h-4 w-4" />
            Reset Password
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => setConfirmOpen(true)}
            className="hover:bg-secondary focus:bg-secondary focus:text-secondary-foreground flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Delete User
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
