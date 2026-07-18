'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Trash2 } from 'lucide-react';
import type { User } from '@prisma/client';
import { getInitials } from '@/app/utils/initials';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import CourseEditUserDialog from '@/components/dialogs/CourseEditUserDialog';
import { EditUserDialog } from '@/components/dialogs/EditUserDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/RoleBadge';
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
  facultyCount?: number;
  // viewer's course role preloaded from course API
  viewerRole?: string | null;
  // whether the viewer is a global site admin
  viewerIsAdmin?: boolean;
};

function ActionsCell({
  user,
  onChange,
  courseId,
  courseIsArchived,
  facultyCount,
  viewerRole,
  viewerIsAdmin,
}: ActionsCellProps) {
  void facultyCount;
  const [open, setOpen] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [courseEditOpen, setCourseEditOpen] = useState(false);

  // Use preloaded viewer role instead of fetching per-row
  const currentCourseRole = viewerRole ?? null;

  // Treat site ADMIN as having course management privileges
  const isSiteAdmin = Boolean(viewerIsAdmin);
  const isCourseAdmin = currentCourseRole === 'FACULTY' || isSiteAdmin;

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

  const handleSave = async (updatedUser: Partial<User>) => {
    const res = await fetch(apiPaths.user(String(updatedUser.id)), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedUser),
    });
    if (res.ok) onChange();
    setOpen(false);
  };

  // Treat the user as a roster item: course role (in `role`) and optional flags
  const rUser = user as RosterUser;
  const courseRole = rUser.role ?? null;
  const hasSubmissions = Boolean(rUser.hasSubmissions);

  // Helper to determine whether the viewer (role `viewer`) can delete a target with course role `target`.
  // Site ADMIN users can delete any roster member. Otherwise fall back to course role rules.
  const canViewerDeleteUser = (
    viewer: string | null | undefined,
    target: string | null,
  ): boolean => {
    // Site admin can remove anyone
    if (isSiteAdmin) return true;
    if (!viewer) return false;
    // Faculty can remove anyone except other faculty
    if (viewer === 'FACULTY') return target !== 'FACULTY';
    return false;
  };

  const viewerCanDelete = canViewerDeleteUser(currentCourseRole, courseRole);

  const deleteTitle = viewerCanDelete
    ? `Remove ${user.firstName} ${user.lastName}?`
    : 'This user cannot be removed from the course';

  const deleteDescription = viewerCanDelete
    ? `This will remove the user from the roster for this course. This action cannot be undone.`
    : 'Contact the instructor to remove this user.';
  // compute UI flags used in JSX
  const removeDisabled = courseIsArchived || hasSubmissions || !viewerCanDelete;
  const removeTitle = courseIsArchived
    ? 'Cannot delete user from archived course'
    : !viewerCanDelete
      ? 'You do not have permission to remove this user'
      : hasSubmissions
        ? 'This user cannot be removed from the course'
        : undefined;

  return (
    <div className="flex items-center gap-2">
      <EditUserDialog user={user} open={open} setOpen={setOpen} onSave={handleSave} />

      {/* Edit button: visible to instructors or site ADMINs */}
      {isCourseAdmin && (
        <Button
          variant="secondary"
          onClick={() => setCourseEditOpen(true)}
          disabled={courseIsArchived}
          title={courseIsArchived ? 'Cannot edit an archived course' : undefined}
          aria-label={`Edit ${user.firstName} ${user.lastName}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}

      {/* Inline delete button for Faculty only (Manage dropdown provides remove action for instructors) */}
      {currentCourseRole === 'FACULTY' && (
        <Button
          variant="destructive"
          disabled={removeDisabled}
          title={removeTitle}
          aria-label={`Remove ${user.firstName} ${user.lastName} from course`}
          onClick={() => {
            if (removeDisabled) return;
            setConfirmOpen(true);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          if (courseIsArchived) {
            showToast.error('Cannot remove user from archived course');
            setConfirmOpen(false);
            return;
          }
          if (!viewerCanDelete) {
            showToast.error('You do not have permission to remove this user');
            setConfirmOpen(false);
            return;
          }
          if (hasSubmissions) {
            showToast.error('This user cannot be removed from the course');
            setConfirmOpen(false);
            return;
          }
          await handleDelete();
          setConfirmOpen(false);
        }}
        title={deleteTitle}
        description={deleteDescription}
        confirmText="Remove"
        cancelText="Cancel"
      />
      <CourseEditUserDialog
        open={courseEditOpen}
        setOpen={setCourseEditOpen}
        courseId={courseId}
        userId={user.id}
        onSaved={onChange}
        initialRoster={{
          role: courseRole,
          user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            avatar: user.avatar,
            role: user.role,
          },
          hasSubmissions: user.hasSubmissions,
        }}
        initialViewerCourseRole={currentCourseRole}
        initialViewerDefaultRole={isSiteAdmin ? 'ADMIN' : null}
      />
    </div>
  );
}

export const userColumns = (
  onChange: () => void,
  courseId: string,
  courseIsArchived: boolean,
  facultyCount?: number,
  viewerRole?: string | null,
  viewerIsAdmin?: boolean,
): ColumnDef<User>[] => {
  const currentCourseRole = viewerRole ?? null;
  const isSiteAdmin = Boolean(viewerIsAdmin);
  const viewerHasActions = isSiteAdmin || currentCourseRole === 'FACULTY';

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
          role={(row.original as RosterUser).role as 'FACULTY' | 'TA' | 'STUDENT' | undefined}
          className="w-20"
        />
      ),
      sortingFn: roleSortingFn,
    },
  ];

  if (viewerHasActions) {
    cols.push({
      id: 'actions',
      header: 'Actions',
      meta: { priority: 1 },
      cell: ({ row }) => (
        <ActionsCell
          user={row.original}
          onChange={onChange}
          courseId={courseId}
          courseIsArchived={courseIsArchived}
          facultyCount={facultyCount}
          viewerRole={viewerRole}
          viewerIsAdmin={viewerIsAdmin}
        />
      ),
    });
  }

  return cols;
};
