'use client';

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { showToast } from '@/lib/toast';
import type { ColumnDef } from '@tanstack/react-table';
import { Trash2, BookOpen, ChevronDown, Copy, Archive, ArchiveRestore } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Course } from '@prisma/client';
import DuplicateCourseDialog from '@/components/dialogs/DuplicateCourseDialog';
import { getInstructors, type EnrolledUser } from '@/lib/course-utils';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { formatDateTimeInTimeZone } from '@/lib/date';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, mutateWithToast } from '@/lib/api/fetch-client';
import { truncate } from '@/lib/utils';

type CourseWithFaculty = Course & {
  // Enrolled list (user objects with courseRole and flags)
  enrolled?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    avatar?: string | null;
    courseRole?: string;
    hasSubmissions?: boolean;
  }[];
};

// Cell for course actions (edit/delete)
type CourseActionsCellProps = {
  course: CourseWithFaculty;
  onCourseDeleted: () => void; // Called after a course is deleted/archived/restored (triggers parent reload)
  onCourseDuplicated: () => void; // Called after a course is duplicated (triggers parent reload)
  timeZone: string;
};

const registrationBadgeTheme = {
  upcoming: { variant: 'info' as const },
  open: { variant: 'success' as const },
  closed: { variant: 'neutral' as const },
} as const;

const normalizeDate = (value?: string | Date | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const getRegistrationStatus = (
  registrationOpenAt?: string | Date | null,
  registrationCloseAt?: string | Date | null,
) => {
  const openAt = normalizeDate(registrationOpenAt);
  const closeAt = normalizeDate(registrationCloseAt);

  if (!openAt || !closeAt) {
    return {
      label: 'Closed',
      theme: registrationBadgeTheme.closed,
    };
  }

  const now = Date.now();
  if (now >= openAt.getTime() && now <= closeAt.getTime()) {
    return {
      label: 'Open',
      theme: registrationBadgeTheme.open,
    };
  }

  if (now < openAt.getTime()) {
    return {
      label: 'Upcoming',
      theme: registrationBadgeTheme.upcoming,
    };
  }

  return {
    label: 'Closed',
    theme: registrationBadgeTheme.closed,
  };
};

export const columns = (
  onCourseDeleted: () => void,
  onCourseDuplicated: () => void,
  timeZone: string,
): ColumnDef<CourseWithFaculty>[] => [
  {
    accessorKey: 'name',
    meta: { priority: 1 },
    header: 'Name',
    cell: ({ row }) => {
      const course = row.original;
      return (
        <Link
          href={`/dashboard/courses/${course.id}`}
          className="text-blue-600 hover:underline"
          title={course.name}
          aria-label={course.name}
        >
          {truncate(course.name, 46)}
        </Link>
      );
    },
  },
  {
    accessorKey: 'code',
    meta: { priority: 3 },
    header: 'Course Code',
  },
  {
    accessorKey: 'credits',
    meta: { priority: 4 },
    header: 'Credits',
  },
  {
    accessorKey: 'semester',
    meta: { priority: 3 },
    header: 'Semester',
  },
  {
    id: 'registrationStatus',
    accessorFn: (row) =>
      getRegistrationStatus(row.registrationOpenAt, row.registrationCloseAt).label,
    meta: { priority: 3 },
    header: 'Registration',
    cell: ({ row }) => {
      const registrationStatus = getRegistrationStatus(
        row.original.registrationOpenAt,
        row.original.registrationCloseAt,
      );
      return (
        <div className="flex justify-center">
          <Badge variant={registrationStatus.theme.variant}>{registrationStatus.label}</Badge>
        </div>
      );
    },
  },
  {
    accessorKey: 'regCode',
    meta: { priority: 2 },
    header: 'Registration Code',
    cell: ({ row }) => {
      const raw = row.getValue<string>('regCode') || '';
      const upper = raw.toUpperCase();
      const formatted = upper.length === 6 ? `${upper.slice(0, 3)}-${upper.slice(3)}` : upper;
      return <span>{formatted}</span>;
    },
  },
  {
    accessorKey: 'startDate',
    meta: { priority: 4 },
    header: 'Start Date',
    cell: ({ row }) => {
      return formatDateTimeInTimeZone(row.original.startDate, timeZone);
    },
  },
  {
    accessorKey: 'endDate',
    meta: { priority: 4 },
    header: 'End Date',
    cell: ({ row }) => {
      return formatDateTimeInTimeZone(row.original.endDate, timeZone);
    },
  },
  {
    id: 'instructor',
    accessorFn: (row) =>
      getInstructors(row.enrolled as EnrolledUser[])
        .map((f) => `${f.firstName ?? ''} ${f.lastName ?? ''}`.trim())
        .filter(Boolean)
        .join(', '),
    meta: { priority: 1 },
    enableSorting: true,
    header: 'Faculty',
    cell: ({ row }) => {
      const faculty = getInstructors(row.original.enrolled as EnrolledUser[]);
      if (faculty.length === 0) {
        return <span className="text-muted-foreground italic">None</span>;
      }
      return faculty
        .map((f) => `${f.firstName ?? ''} ${f.lastName ?? ''}`.trim())
        .filter(Boolean)
        .join(', ');
    },
  },
  {
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    enableSorting: false,
    meta: { priority: 1 },
    cell: ({ row }) => {
      const course = row.original;
      return (
        <CourseActionsCell
          course={course}
          onCourseDeleted={onCourseDeleted}
          onCourseDuplicated={onCourseDuplicated}
          timeZone={timeZone}
        />
      );
    },
  },
];

function CourseActionsCell({
  course,
  onCourseDeleted,
  onCourseDuplicated,
  timeZone,
}: CourseActionsCellProps) {
  const { data: session } = useSession();
  // Duplicating and archiving/restoring a course are system-admin-only actions; the
  // routes enforce this too.
  const isAdmin = session?.user?.isAdmin === true;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  // Archive (active -> archived) or restore (archived -> active). Both move the
  // course off the current list, so refresh once the change lands. Un-archiving is
  // admin-only; the API enforces that, and the Restore item only shows on the
  // archived page (whose actions column is already admin-only).
  const handleArchiveToggle = async () => {
    const nextArchived = !course.isArchived;
    const result = await mutateWithToast(
      () => apiClient.patch(apiPaths.courseArchive(course.id), { isArchived: nextArchived }),
      {
        success: nextArchived ? 'Course archived' : 'Course restored',
        error: 'Failed to update the course',
      },
    );
    if (!result.ok) return;
    setArchiveConfirmOpen(false);
    onCourseDeleted();
  };

  const handleDelete = async () => {
    // The server decides hard vs soft based on whether the course holds any data, so
    // the success message depends on the response body — toast it manually on success.
    const result = await mutateWithToast(
      () => apiClient.del<{ deleted?: 'hard' | 'soft' }>(apiPaths.course(course.id)),
      { error: 'Error deleting course' },
    );
    if (!result.ok) return;
    showToast.success(
      result.data?.deleted === 'hard'
        ? 'Course permanently deleted'
        : 'Course deleted (its data is retained)',
    );
    setConfirmOpen(false);
    onCourseDeleted?.();
  };

  return (
    <>
      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Delete Course"
        description={`Delete "${course.name}"? If it has no assignments, problems, or students, it is removed permanently. Otherwise it is hidden and its data is retained.`}
        confirmText="Delete"
      />

      <ConfirmDialog
        open={archiveConfirmOpen}
        onCancel={() => setArchiveConfirmOpen(false)}
        onConfirm={() => void handleArchiveToggle()}
        title={course.isArchived ? 'Restore Course' : 'Archive Course'}
        description={
          course.isArchived
            ? `Restore "${course.name}"? It becomes editable again and returns to the active courses list.`
            : `Archive "${course.name}"? It becomes read-only for everyone and moves to the Archived Courses page.`
        }
        confirmText={course.isArchived ? 'Restore' : 'Archive'}
      />

      {isAdmin && (
        <DuplicateCourseDialog
          open={duplicateOpen}
          setOpen={setDuplicateOpen}
          course={course}
          timeZone={timeZone}
          onSuccess={() => {
            setDuplicateOpen(false);
            onCourseDuplicated();
          }}
        />
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" aria-label={`Manage course ${course.name}`}>
            <ChevronDown /> Manage
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            {course.name}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="hover:bg-secondary flex items-center gap-2">
            <Link href={`/dashboard/courses/${course.id}`}>
              <BookOpen className="mr-2 h-4 w-4" />
              View Course
            </Link>
          </DropdownMenuItem>
          {/* Editing a course now lives on the course's Settings tab, so it's not
              duplicated here. Duplicate and archive/restore are admin-only. */}
          {isAdmin && (
            <DropdownMenuItem
              onClick={() => setDuplicateOpen(true)}
              className="hover:bg-secondary flex items-center gap-2"
            >
              <Copy className="mr-2 h-4 w-4" />
              Duplicate Course
            </DropdownMenuItem>
          )}
          {isAdmin &&
            (course.isArchived ? (
              <DropdownMenuItem
                onClick={() => setArchiveConfirmOpen(true)}
                className="hover:bg-secondary flex items-center gap-2"
              >
                <ArchiveRestore className="mr-2 h-4 w-4" />
                Restore Course
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => setArchiveConfirmOpen(true)}
                className="hover:bg-secondary flex items-center gap-2"
              >
                <Archive className="mr-2 h-4 w-4" />
                Archive Course
              </DropdownMenuItem>
            ))}
          {/* Deleting is admin-only and lives on the active course list; archived
              courses must be restored first. */}
          {isAdmin && !course.isArchived && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setConfirmOpen(true)}
                className="hover:bg-secondary flex items-center gap-2 text-red-600 focus:text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Course
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
