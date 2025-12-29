'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Delete, Pencil, ChevronDown, UserRound } from 'lucide-react';
import { User } from '@prisma/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EditUserDialog } from '@/components/dialogs/EditUserDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/RoleBadge';
import { roleSortingFn } from '@/lib/role-sorting';
import { showToast } from '@/lib/toast';
import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

type ActionsCellProps = {
  user: User;
  onChange: () => void;
  courseId: string;
  courseIsArchived: boolean;
  facultyCount?: number;
};

function ActionsCell({ user, onChange, courseId, courseIsArchived, facultyCount }: ActionsCellProps) {
  const [open, setOpen] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDelete = async () => {
    try {
      // remove user from the course roster instead of deleting the user record
      const res = await fetch(`/api/courses/${courseId}/roster/${user.id}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) {
        // try to read message from server
        const data = await res.json().catch(() => ({}));
        const msg = data?.error || data?.message || `Server returned ${res.status}`;
        showToast.error(msg || 'Failed to remove user');
        console.error('[DELETE] server error', msg, data);
        return;
      }
      onChange();
      showToast.success('User removed from roster');
    } catch (err) {
      // network or fetch error
      console.error('[DELETE] fetch error', err);
      showToast.error(`Network error removing user: ${(err as Error).message || err}`);
    }
  };

  const handleSave = async (updatedUser: Partial<User>) => {
    const res = await fetch(`/api/users/${updatedUser.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedUser),
    });
    if (res.ok) onChange();
    setOpen(false);
  };

  // user may have been augmented from the API with hasSubmissions boolean
  const userWithMeta = user as User & { hasSubmissions?: boolean };
  const isFacultyOnly = userWithMeta.role === 'FACULTY' && typeof facultyCount === 'number' && facultyCount <= 1;

  return (
    <div className="flex gap-2">
      <EditUserDialog user={user} open={open} setOpen={setOpen} onSave={handleSave} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            <ChevronDown />
            Manage
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="flex items-center gap-2">
            <UserRound className="h-4 w-4" />
            {user.firstName} {user.lastName}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setOpen(true)}
            className="flex items-center gap-2"
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit User
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {/* Disable the Drop action when the student has submissions */}
          {
            (() => {
              const disabled = Boolean(userWithMeta.hasSubmissions) || isFacultyOnly;
              return (
                <DropdownMenuItem
                  onClick={() => {
                    if (disabled) return;
                    setConfirmOpen(true);
                  }}
                  disabled={courseIsArchived || disabled}
                  className={`focus:text-red-600 flex items-center gap-2 text-red-600 ${
                    disabled ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  title={courseIsArchived ? 'Cannot delete user from archived course' : disabled ? 'User has submissions for this course and cannot be removed' : undefined}
                >
                  <Delete className="mr-2 h-4 w-4" />
                  Drop User
                </DropdownMenuItem>
              );
            })()
          }
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          await handleDelete();
          setConfirmOpen(false);
        }}
        title={`Remove ${user.firstName} ${user.lastName}?`}
        description={`This will remove the user from the roster for this course. This action cannot be undone.`}
        confirmText="Remove"
        cancelText="Cancel"
      />
    </div>
  );
}

export const userColumns = (onChange: () => void, courseId: string, courseIsArchived: boolean, facultyCount?: number): ColumnDef<User>[] => [
  {
    id: 'avatar',
    header: '',
    cell: ({ row }) => {
      const user = row.original;
      const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase();
      const avatarUrl = user.avatar ? `/uploads/pfps/${user.avatar}` : '/uploads/pfps/default-avatar.png';
      
      return (
        <Avatar className="h-10 w-10">
          <AvatarImage
            src={avatarUrl}
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
  },
  {
    accessorKey: 'lastName',
    header: 'Last Name',
  },
  {
    accessorKey: 'email',
    header: 'Email',
    cell: ({ row }) => {
      const email = row.original.email;
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
    cell: ({ row }) => <Badge role={row.original.role} className="w-20" />,
    sortingFn: roleSortingFn,
  },
  {
    id: 'actions',
    header: '',
  cell: ({ row }) => <ActionsCell user={row.original} onChange={onChange} courseId={courseId} courseIsArchived={courseIsArchived} facultyCount={facultyCount} />,
  },
];
