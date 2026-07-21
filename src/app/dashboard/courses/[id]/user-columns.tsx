'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ChevronDown, Lock, Pencil, Tag, UserRoundX } from 'lucide-react';
import type { User } from '@prisma/client';
import { getInitials } from '@/app/utils/initials';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EditUserDialog } from '@/components/dialogs/EditUserDialog';
import { EditRoleDialog } from '@/components/dialogs/EditRoleDialog';
import { ResetPasswordDialog } from '@/components/dialogs/ResetPasswordDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/RoleBadge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { roleSortingFn } from '@/lib/roles';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { useState } from 'react';


type RosterUser = User & { role?: string; hasSubmissions?: boolean };

type ActionsCellProps = {
  user: RosterUser;
  onChange: () => void;
  courseId: string;
  courseIsArchived: boolean;
  viewerRole?: string | null;
  viewerIsAdmin?: boolean | null;
};


function ActionsCell({
  user,
  onChange,
  courseId,
  courseIsArchived,
  viewerRole,
  viewerIsAdmin,
}: ActionsCellProps) {
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [ editRoleOpen, setEditRoleOpen ] = useState(false);
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
      onChange();
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : 'Failed to reset password.');
    }
  }

  const handleDelete = async () => {
    try {
      // remove user from the course roster instead of deleting the user record
      const res = await fetch(apiPaths.courseRosterEntry(courseId, user.id), {
        method: 'DELETE',
        credentials: 'same-origin',
      });
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

  // Treat the user as a roster item: course role (in `role`) and optional flags
  const rUser = user as RosterUser;
  const courseRole = rUser.role ?? null;
  const hasSubmissions = Boolean(rUser.hasSubmissions);
  const isPrivileged = viewerIsAdmin || viewerRole === 'FACULTY' || viewerRole === 'TA';

  const deleteTitle = `Remove ${user.firstName} ${user.lastName}?`;
  const deleteDescription = `This will remove the user from the roster for this course. This action cannot be undone.`

  const removeDisabled = courseIsArchived || hasSubmissions || !isPrivileged;
  const removeTitle = courseIsArchived
    ? 'Cannot delete user from archived course'
    : !isPrivileged
      ? 'You do not have permission to remove this user'
      : hasSubmissions
        ? 'This user cannot be removed from the course'
        : undefined;

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            aria-label={`Manage ${user.firstName} ${user.lastName}`}
            className="inline-flex items-center gap-2"
            disabled={courseRole === 'FACULTY' && !viewerIsAdmin}
          >
            Manage
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          <DropdownMenuLabel className="font-medium">{`${user.firstName} ${user.lastName}`}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {viewerIsAdmin ? (
            <DropdownMenuItem
              onClick={() => setEditUserOpen(true)}
              className="flex items-center gap-2"
            >
              <Pencil className="h-4 w-4" />
              Edit User
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onClick={() => setEditRoleOpen(true)}
            className="flex items-center gap-2"
          >
            <Tag className="h-4 w-4" />
            Edit Role
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setResetOpen(true)}
            className="flex items-center gap-2"
          >
            <Lock className="h-4 w-4" />
            Reset Password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={removeDisabled}
            title={removeTitle}
            className={`flex items-center gap-2 ${removeDisabled ? 'cursor-not-allowed text-muted-foreground' : 'text-destructive focus:text-destructive'}`}
          >
            <UserRoundX className="h-4 w-4" />
            Remove From Course
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EditUserDialog
        user={user}
        open={editUserOpen}
        setOpen={setEditUserOpen}
        onSave={async () => {
          onChange();
        }}
      />

      <EditRoleDialog
        open={editRoleOpen}
        setOpen={setEditRoleOpen}
        courseId={courseId}
        userId={user.id}
        onSaved={onChange}
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
        onConfirm={async () => {
          if (courseIsArchived) {
            showToast.error('Cannot remove user from archived course');
            setConfirmDeleteOpen(false);
            return;
          }
          if (!isPrivileged) {
            showToast.error('You do not have permission to remove this user');
            setConfirmDeleteOpen(false);
            return;
          }
          if (hasSubmissions) {
            showToast.error('This user cannot be removed from the course');
            setConfirmDeleteOpen(false);
            return;
          }
          await handleDelete();
          setConfirmDeleteOpen(false);
        }}
        title={deleteTitle}
        description={deleteDescription}
        confirmText="Remove"
        cancelText="Cancel"
      />
    </div>
  );
}


export const userColumns = (
  onChange: () => void,
  courseId: string,
  courseIsArchived: boolean,
  viewerRole?: string | null,
  viewerIsAdmin?: boolean | null,
): ColumnDef<User>[] => {
  const currentCourseRole = viewerRole ?? null;
  const viewerHasActions = viewerIsAdmin || currentCourseRole === 'FACULTY' || currentCourseRole === 'TA';

  const cols: ColumnDef<User>[] = [
    {
      id: 'avatar',
      meta: { priority: 4 },
      header: () => <span className="sr-only">Avatar</span>,
      cell: ({ row }) => {
        const user = row.original;

        return (
          <Avatar className="h-10 w-10">
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
      meta: { priority: 2 },
    },
    {
      accessorKey: 'email',
      header: 'Email',
      meta: { priority: 3 },
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
      meta: {
        priority: 2,
        filterVariant: 'multiselect',
        filterLabel: 'Role',
        filterOptions: [
          { label: 'Faculty', value: 'FACULTY' },
          { label: 'TA', value: 'TA' },
          { label: 'Student', value: 'STUDENT' },
        ],
      },
      cell: ({ row }) => (
        <Badge
          userRole={(row.original as RosterUser).role as 'FACULTY' | 'TA' | 'STUDENT' | undefined}
          className="w-20"
        />
      ),
      sortingFn: roleSortingFn,
    },
  ];

  if (viewerHasActions) {
    cols.push({
      id: 'manage',
      header: 'Manage',
      meta: { priority: 1 },
      cell: ({ row }) => (
        <ActionsCell
          user={row.original}
          onChange={onChange}
          courseId={courseId}
          courseIsArchived={courseIsArchived}
          viewerRole={viewerRole}
          viewerIsAdmin={viewerIsAdmin}
        />
      ),
    });
  }

  return cols;
};
