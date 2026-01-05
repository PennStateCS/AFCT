'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Delete, Pencil } from 'lucide-react';
import { User } from '@prisma/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { EditUserDialog } from '@/components/dialogs/EditUserDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/RoleBadge';
import { roleSortingFn } from '@/lib/role-sorting';
import { showToast } from '@/lib/toast';
import { useState } from 'react';
import CourseEditUserDialog from '@/components/dialogs/CourseEditUserDialog';
// RosterUser is a User record augmented with course-specific role and flags
type RosterUser = User & { role?: string; hasSubmissions?: boolean };

type ActionsCellProps = {
  user: RosterUser;
  onChange: () => void;
  courseId: string;
  courseIsArchived: boolean;
  facultyCount?: number;
  // viewer's course role preloaded from course API
  viewerRole?: string | null;
  // viewer's global default role (ADMIN | FACULTY | TA | STUDENT)
  viewerDefaultRole?: string | null;
};

function ActionsCell({ user, onChange, courseId, courseIsArchived, facultyCount, viewerRole, viewerDefaultRole }: ActionsCellProps) {
  const [open, setOpen] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [courseEditOpen, setCourseEditOpen] = useState(false);

  // Use preloaded viewer role instead of fetching per-row
  const currentCourseRole = viewerRole ?? null;

  // Treat site ADMIN as having course management privileges
  const isSiteAdmin = viewerDefaultRole === 'ADMIN';
  const isCourseAdmin = currentCourseRole === 'COURSE_ADMIN' || isSiteAdmin;

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

  // Treat the user as a roster item: course role (in `role`) and optional flags
  const rUser = user as RosterUser;
  const courseRole = rUser.role ?? null;
  const hasSubmissions = Boolean(rUser.hasSubmissions);

  // Helper to determine whether the viewer (role `viewer`) can delete a target with course role `target`.
  // Site ADMIN users can delete any roster member. Otherwise fall back to course role rules.
  const canViewerDeleteUser = (
    viewer: string | null | undefined,
    target: string,
  ): boolean => {
    // Site admin can remove anyone
    if (isSiteAdmin) return true;
    if (!viewer) return false;
    // Course admin can remove anyone except other course admins
    if (viewer === 'COURSE_ADMIN') return target !== 'COURSE_ADMIN';
    // Faculty can remove anyone except course admins and other faculty
    if (viewer === 'FACULTY') return target !== 'COURSE_ADMIN' && target !== 'FACULTY';
    return false;
  };

  const viewerCanDelete = canViewerDeleteUser(currentCourseRole, courseRole);

  const deleteTitle = viewerCanDelete
    ? `Remove ${user.firstName} ${user.lastName}?`
    : 'This user cannot be removed from the course';

  const deleteDescription = viewerCanDelete
    ? `This will remove the user from the roster for this course. This action cannot be undone.`
    : 'Contact the course admin to remove this user.';
  // compute UI flags used in JSX
  const removeDisabled = courseIsArchived || hasSubmissions || !viewerCanDelete;
  const removeTitle = courseIsArchived
    ? 'Cannot delete user from archived course'
    : !viewerCanDelete
    ? 'You do not have permission to remove this user'
    : hasSubmissions
    ? 'This user cannot be removed from the course'
    : undefined;

  const canInlineDelete = viewerCanDelete && !hasSubmissions && !courseIsArchived;
  return (
    <div className="flex gap-2 items-center">
      <EditUserDialog user={user} open={open} setOpen={setOpen} onSave={handleSave} />

      {/* Edit button: visible to course admins or site ADMINs */}
      {isCourseAdmin && (
        <Button
          variant="secondary"
          onClick={() => setCourseEditOpen(true)}
          disabled={courseIsArchived}
          title={courseIsArchived ? 'Cannot edit an archived course' : undefined}
          aria-label="Edit"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}

      {/* Inline delete button for Faculty only (Manage dropdown provides remove action for admins/course admins) */}
      {currentCourseRole === "FACULTY" && (
        <Button
          variant="destructive"
          disabled={removeDisabled}
          title={removeTitle}
          onClick={() => {
            if (removeDisabled) return;
            setConfirmOpen(true);
          }}
        >
          <Delete />
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
        initialRoster={{ role: courseRole, user: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, avatar: user.avatar, role: user.role }, hasSubmissions: user.hasSubmissions }}
        initialViewerCourseRole={currentCourseRole}
        initialViewerDefaultRole={viewerDefaultRole}
      />
    </div>
  );
}

export const userColumns = (onChange: () => void, courseId: string, courseIsArchived: boolean, facultyCount?: number, viewerRole?: string | null, viewerDefaultRole?: string | null): ColumnDef<User>[] => {
  const currentCourseRole = viewerRole ?? null;
  const isSiteAdmin = viewerDefaultRole === 'ADMIN';
  const viewerHasActions = isSiteAdmin || currentCourseRole === 'COURSE_ADMIN' || currentCourseRole === 'FACULTY';

  const cols: ColumnDef<User>[] = [
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
      cell: ({ row }) => <Badge role={(row.original as RosterUser).role} className="w-20" />,
      sortingFn: roleSortingFn,
    },
  ];

  if (viewerHasActions) {
    cols.push({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => <ActionsCell user={row.original} onChange={onChange} courseId={courseId} courseIsArchived={courseIsArchived} facultyCount={facultyCount} viewerRole={viewerRole} viewerDefaultRole={viewerDefaultRole} />,
    });
  }

  return cols;
};
