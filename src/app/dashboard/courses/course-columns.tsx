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
import { REGISTRATION_STATUS_BADGE } from '@/lib/badge-presets';
import { showToast } from '@/lib/toast';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Trash2,
  BookOpen,
  EllipsisVertical,
  Copy,
  Archive,
  ArchiveRestore,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Course } from '@prisma/client';
import dynamic from 'next/dynamic';
import { getInstructors, type EnrolledUser } from '@/lib/course-roster';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { CompactDate } from '@/components/ui/CompactDate';
import { formatRegistrationCode } from '@/lib/format-registration-code';
import { apiPaths } from '@/lib/api-paths';
import { apiClient, mutateWithToast } from '@/lib/api/fetch-client';
import { truncate } from '@/lib/truncate';
import { TEXT_LINK_CLASS } from '@/lib/link-styles';

/**
 * On demand, and rendered per row: the duplicate wizard carries the form stack, and a course
 * list used to mount one per course. This is the only zod path on the courses and
 * archived-courses pages, which share these columns.
 */
const DuplicateCourseDialog = dynamic(() => import('@/components/dialogs/DuplicateCourseDialog'), {
  ssr: false,
});

/** True once `open` has first been true. See the dynamic import above. */
function useMountedOnce(open: boolean): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted || open;
}

type CourseWithFaculty = Course & {
  /** The LMSs that open this course, empty when none does. */
  lmsNames?: string[];
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
      theme: { variant: REGISTRATION_STATUS_BADGE.closed },
    };
  }

  const now = Date.now();
  if (now >= openAt.getTime() && now <= closeAt.getTime()) {
    return {
      label: 'Open',
      theme: { variant: REGISTRATION_STATUS_BADGE.open },
    };
  }

  if (now < openAt.getTime()) {
    return {
      label: 'Upcoming',
      theme: { variant: REGISTRATION_STATUS_BADGE.upcoming },
    };
  }

  return {
    label: 'Closed',
    theme: { variant: REGISTRATION_STATUS_BADGE.closed },
  };
};

export const columns = (
  onCourseDeleted: () => void,
  onCourseDuplicated: () => void,
  timeZone: string,
  hour12 = true,
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
          className={TEXT_LINK_CLASS}
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
    meta: { priority: 4, filterVariant: 'multiselect' },
    header: 'Credits',
  },
  {
    accessorKey: 'semester',
    meta: { priority: 3, filterVariant: 'multiselect' },
    header: 'Semester',
  },
  {
    id: 'registrationStatus',
    accessorFn: (row) =>
      getRegistrationStatus(row.registrationOpenAt, row.registrationCloseAt).label,
    meta: { priority: 3, filterVariant: 'multiselect', filterLabel: 'Registration' },
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
    cell: ({ row }) => (
      // Mono: a registration code is something people read out and type in, so the
      // characters want fixed widths.
      <span className="font-mono text-sm">
        {formatRegistrationCode(row.getValue<string>('regCode'))}
      </span>
    ),
  },
  {
    accessorKey: 'startDate',
    meta: { priority: 4 },
    header: 'Start Date',
    cell: ({ row }) => <CompactDate value={row.original.startDate} timeZone={timeZone} hour12={hour12} />,
  },
  {
    accessorKey: 'endDate',
    meta: { priority: 4 },
    header: 'End Date',
    cell: ({ row }) => <CompactDate value={row.original.endDate} timeZone={timeZone} hour12={hour12} />,
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
    id: 'lms',
    accessorFn: (row) => (row.lmsNames?.length ? row.lmsNames.join(', ') : ''),
    // Shown from `lg` up, like the other secondary columns: it is useful context rather than
    // something you scan a course list for, and it is meaningless at an institution with no LMS.
    meta: { priority: 3 },
    enableSorting: true,
    header: 'LMS',
    cell: ({ row }) => {
      const names = row.original.lmsNames ?? [];
      if (names.length === 0) {
        return <span className="text-muted-foreground">Not connected</span>;
      }
      // Named rather than a tick: which LMS matters when an institution runs more than one,
      // and a word reads the same to everybody.
      return names.join(', ');
    },
  },
  {
    id: 'actions',
    // Visible now rather than sr-only: the trigger used to say "Manage" on its face, so
    // the column named itself. A bare ellipsis does not.
    header: 'Actions',
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
  const duplicateMounted = useMountedOnce(duplicateOpen);

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
    // the success message depends on the response body; toast it manually on success.
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
        variant="destructive"
        title="Delete course?"
        description={`If "${course.name}" has no assignments, problems, or students, it is removed permanently. Otherwise it is hidden and its data is retained.`}
        confirmText="Delete course"
      />

      <ConfirmDialog
        open={archiveConfirmOpen}
        onCancel={() => setArchiveConfirmOpen(false)}
        onConfirm={handleArchiveToggle}
        title={course.isArchived ? 'Restore course?' : 'Archive course?'}
        description={
          course.isArchived
            ? `"${course.name}" becomes editable again and returns to the active courses list.`
            : `"${course.name}" becomes read-only for everyone and moves to the Archived Courses page.`
        }
        confirmText={course.isArchived ? 'Restore course' : 'Archive course'}
      />

      {isAdmin && duplicateMounted && (
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
          {/* Every row carries one of these, so the label names the course: a dozen
              buttons all called "More" is what a screen reader would otherwise hear. */}
          <Button variant="ghost" size="icon" aria-label={`Actions for ${course.name}`}>
            <EllipsisVertical className="h-4 w-4" />
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
          {/* Jump straight to the course's Settings tab (editing lives there now). */}
          <DropdownMenuItem asChild className="hover:bg-secondary flex items-center gap-2">
            <Link href={`/dashboard/courses/${course.id}?tab=settings`}>
              <Settings className="mr-2 h-4 w-4" />
              Course Settings
            </Link>
          </DropdownMenuItem>
          {/* Duplicate and archive/restore are admin-only. */}
          {isAdmin && (
            <DropdownMenuItem
              onClick={() => setDuplicateOpen(true)}
              className="hover:bg-secondary flex items-center gap-2"
            >
              <Copy className="mr-2 h-4 w-4" />
              Duplicate Course
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <DropdownMenuItem
              onClick={() => setArchiveConfirmOpen(true)}
              className="hover:bg-secondary flex items-center gap-2"
            >
              {course.isArchived ? (
                <ArchiveRestore className="mr-2 h-4 w-4" />
              ) : (
                <Archive className="mr-2 h-4 w-4" />
              )}
              {course.isArchived ? 'Restore Course' : 'Archive Course'}
            </DropdownMenuItem>
          )}
          {/* Deleting is admin-only and lives on the active course list; archived
              courses must be restored first. */}
          {isAdmin && !course.isArchived && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setConfirmOpen(true)}
                className="hover:bg-secondary text-destructive focus:text-destructive flex items-center gap-2"
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
