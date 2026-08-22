'use client';

import type { ColumnDef } from '@tanstack/react-table';
import {
  EllipsisVertical,
  Lock,
  Pencil,
  Tag,
  UserRoundX,
  UserRoundMinus,
  UserRoundCheck,
} from 'lucide-react';
import type { User } from '@prisma/client';
import { getInitials } from '@/app/utils/initials';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import dynamic from 'next/dynamic';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

/**
 * On demand, and this file is rendered PER ROSTER ROW, so a large course used to mount three
 * form dialogs per student before anyone opened one. Deferring them takes zod off the course
 * page as well as trimming that runtime cost. `ConfirmDialog` stays static; it is small and
 * shared app-wide.
 */
const EditUserDialog = dynamic(
  () => import('@/components/dialogs/EditUserDialog').then((m) => m.EditUserDialog),
  { ssr: false },
);
const EditRoleDialog = dynamic(
  () => import('@/components/dialogs/EditRoleDialog').then((m) => m.EditRoleDialog),
  { ssr: false },
);
const ResetPasswordDialog = dynamic(
  () => import('@/components/dialogs/ResetPasswordDialog').then((m) => m.ResetPasswordDialog),
  { ssr: false },
);

/** True once `open` has first been true. See the dynamic imports above. */
function useMountedOnce(open: boolean): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted || open;
}
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
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { useEffect, useState } from 'react';

type RosterUser = User & {
  role?: string;
  hasSubmissions?: boolean;
  // Enrollment standing for a student ('ENROLLED' | 'DROPPED'); undefined for staff.
  enrollmentStatus?: string;
};

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
  const [editRoleOpen, setEditRoleOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [dropConfirmOpen, setDropConfirmOpen] = useState(false);
  const editUserMounted = useMountedOnce(editUserOpen);
  const editRoleMounted = useMountedOnce(editRoleOpen);
  const resetMounted = useMountedOnce(resetOpen);

  async function handlePasswordReset(newPassword: string, isTemporary: boolean) {
    try {
      const res = await fetch(apiPaths.courseRosterResetPassword(courseId, user.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ newPassword, isTemporary }),
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

  const handleStatusChange = async (newStatus: 'ENROLLED' | 'DROPPED') => {
    try {
      const res = await fetch(apiPaths.courseRosterStatus(courseId, user.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to update enrollment.');
      }
      onChange();
      showToast.success(
        newStatus === 'DROPPED' ? 'Student dropped from course' : 'Student re-enrolled',
      );
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : 'Failed to update enrollment.');
    }
  };

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
  // Dropping / re-enrolling is faculty/admin only (matches the status endpoint; TAs may
  // not), and only applies to students.
  const canManageEnrollment = Boolean(viewerIsAdmin || viewerRole === 'FACULTY');
  const isStudent = courseRole === 'STUDENT';
  const isDropped = rUser.enrollmentStatus === 'DROPPED';

  const deleteTitle = `Remove ${user.firstName} ${user.lastName} from the course?`;
  const deleteDescription = `This removes their access and roster entry for this course and cannot be undone. To revoke access while keeping a student's work, drop them instead.`;

  const removeDisabled = courseIsArchived || hasSubmissions || !isPrivileged;
  const removeTitle = courseIsArchived
    ? 'Cannot delete user from archived course'
    : !isPrivileged
      ? 'You do not have permission to remove this user'
      : hasSubmissions
        ? 'This student has work in the course and cannot be removed. Drop them instead to revoke access while keeping their submissions.'
        : undefined;

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${user.firstName} ${user.lastName}`}
            disabled={courseRole === 'FACULTY' && !viewerIsAdmin}
          >
            <EllipsisVertical className="h-4 w-4" />
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
          {courseRole === 'STUDENT' ? (
            <DropdownMenuItem
              onClick={() => setResetOpen(true)}
              className="flex items-center gap-2"
            >
              <Lock className="h-4 w-4" />
              Reset Password
            </DropdownMenuItem>
          ) : null}
          {isStudent && canManageEnrollment ? (
            isDropped ? (
              <DropdownMenuItem
                onClick={() => void handleStatusChange('ENROLLED')}
                disabled={courseIsArchived}
                title={
                  courseIsArchived ? 'Cannot change enrollment in an archived course' : undefined
                }
                className="flex items-center gap-2"
              >
                <UserRoundCheck className="h-4 w-4" />
                Re-enroll
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => setDropConfirmOpen(true)}
                disabled={courseIsArchived}
                title={
                  courseIsArchived ? 'Cannot change enrollment in an archived course' : undefined
                }
                className="flex items-center gap-2"
              >
                <UserRoundMinus className="h-4 w-4" />
                Drop From Course
              </DropdownMenuItem>
            )
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={removeDisabled}
            title={removeTitle}
            className={`flex items-center gap-2 ${removeDisabled ? 'text-muted-foreground cursor-not-allowed' : 'text-destructive focus:text-destructive'}`}
          >
            <UserRoundX className="h-4 w-4" />
            Remove From Course
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {editUserMounted && (
        <EditUserDialog
          user={user}
          open={editUserOpen}
          setOpen={setEditUserOpen}
          // The roster's user objects don't carry the global `isAdmin` flag, and changing
          // global admin from a course context is out of scope, so never manage it here.
          canManageAdmin={false}
          onSave={async () => {
            onChange();
          }}
        />
      )}

      {editRoleMounted && (
        <EditRoleDialog
          open={editRoleOpen}
          setOpen={setEditRoleOpen}
          courseId={courseId}
          userId={user.id}
          onSaved={onChange}
        />
      )}

      {resetMounted && (
        <ResetPasswordDialog
          open={resetOpen}
          setOpen={setResetOpen}
          onResetPassword={handlePasswordReset}
          targetUserName={`${user.firstName} ${user.lastName}`}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          if (courseIsArchived) {
            showToast.error(
              'This course is archived, so its roster cannot be changed. Unarchive the course first.',
            );
            setConfirmDeleteOpen(false);
            return;
          }
          if (!isPrivileged) {
            showToast.error('You do not have permission to remove this user');
            setConfirmDeleteOpen(false);
            return;
          }
          if (hasSubmissions) {
            showToast.error(
              'This student has submitted work, so they cannot be removed. Their submissions are part of the course record.',
            );
            setConfirmDeleteOpen(false);
            return;
          }
          await handleDelete();
          setConfirmDeleteOpen(false);
        }}
        variant="destructive"
        title={deleteTitle}
        description={deleteDescription}
        confirmText="Remove from course"
      />

      <ConfirmDialog
        open={dropConfirmOpen}
        onCancel={() => setDropConfirmOpen(false)}
        onConfirm={async () => {
          await handleStatusChange('DROPPED');
          setDropConfirmOpen(false);
        }}
        title="Drop student from course?"
        description={`${user.firstName} ${user.lastName} immediately loses access to the course but keeps their submissions, grades, and group membership. You can re-enroll them later.`}
        confirmText="Drop student"
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
  const viewerHasActions =
    viewerIsAdmin || currentCourseRole === 'FACULTY' || currentCourseRole === 'TA';

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
            <AvatarFallback>
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
          <a href={`mailto:${email}`} className="text-primary hover:underline">
            {email}
          </a>
        );
      },
    },
    {
      // `role` here is the COURSE role, which the server sends on every roster row.
      accessorKey: 'role',
      header: 'Role',
      // No filterVariant: the table shows one server-ordered page, so its faceted filter
      // could only narrow the rows already on screen. Role and Status are filtered through
      // the toolbar's Filters menu in RosterCard instead. Same reason there is no
      // sortingFn: ordering is the server's, over the whole roster.
      meta: { priority: 2 },
      cell: ({ row }) => (
        <Badge
          userRole={(row.original as RosterUser).role as 'FACULTY' | 'TA' | 'STUDENT' | undefined}
          className="w-20"
        />
      ),
    },
    {
      id: 'enrollmentStatus',
      header: 'Status',
      // Staff have no enrollment standing; report ENROLLED so the "Enrolled" filter keeps
      // them and only "Dropped" isolates dropped students. (Student rows always carry a
      // real status from the server.)
      accessorFn: (row) => (row as RosterUser).enrollmentStatus ?? 'ENROLLED',
      // Filtered from the toolbar's Filters menu, not here; see the Role column above.
      meta: { priority: 2 },
      cell: ({ row }) => {
        const r = row.original as RosterUser;
        // Status only applies to students; staff show a dash.
        if (r.role !== 'STUDENT') return <span className="text-muted-foreground">—</span>;
        // Both standings are pills, and deliberately the same shape: one of them rendered as
        // plain text read as an absence of status rather than as the opposite of Dropped.
        return r.enrollmentStatus === 'DROPPED' ? (
          <span className="bg-status-warning-bg text-status-warning inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
            Dropped
          </span>
        ) : (
          <span className="bg-status-success-bg text-status-success inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
            Enrolled
          </span>
        );
      },
    },
  ];

  if (viewerHasActions) {
    cols.push({
      id: 'manage',
      header: 'Actions',
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
