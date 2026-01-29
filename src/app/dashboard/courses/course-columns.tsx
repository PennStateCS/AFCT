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
import { showToast } from '@/lib/toast';
import { ColumnDef } from '@tanstack/react-table';
import { Pencil, Trash2, BookOpen, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';
import { useState } from 'react';
import { Course } from '@prisma/client';
import { EditCourseDialog } from '@/components/dialogs/EditCourseDialog';
import { getInstructors, formatInstructorNames } from '@/lib/course-utils';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

type CourseWithFaculty = Course & {
  // Enrolled list (user objects with courseRole and flags)
  enrolled?: ({ id: string; firstName?: string | null; lastName?: string | null; email?: string | null; avatar?: string | null; courseRole?: string; hasSubmissions?: boolean })[];
};

// Cell for course actions (edit/delete)
type CourseActionsCellProps = {
  course: CourseWithFaculty;
  onCourseUpdated: (updated: CourseWithFaculty) => void; // Called when a course is updated (edit/save)
  onCourseDeleted: () => void; // Called after a course is deleted (triggers parent reload)
}

export const columns = (
  onCourseUpdated: (updated: CourseWithFaculty) => void,
  onCourseDeleted: () => void,
): ColumnDef<CourseWithFaculty>[] => [
  {
    accessorKey: 'name',
    meta: { priority: 1 },
    header: 'Name',
    cell: ({ row }) => {
      const course = row.original;
      return (
        <Link href={`/dashboard/courses/${course.id}`} className="text-blue-600 hover:underline">
          {course.name.substring(0, 46) + (course.name.length > 47 ? "..." : "")}
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
    accessorKey: 'semester',
    meta: { priority: 3 },
    header: 'Semester',
  },
  {
    accessorKey: 'startDate',
    meta: { priority: 4 },
    header: 'Start Date',
    cell: ({ row }) => {
      const date = new Date(row.original.startDate);
      return format(date, "M/d/yyyy");
    },
  },
  {
    accessorKey: 'endDate',
    meta: { priority: 4 },
    header: 'End Date',
    cell: ({ row }) => {
      const date = new Date(row.original.endDate);
      return format(date, "M/d/yyyy");
    },
  },
  {
    id: 'instructor',
    accessorFn: (row) => formatInstructorNames(row.enrolled as any[]),
    meta: { priority: 1 },
    enableSorting: true,
    header: 'Instructor(s)',
    cell: ({ row }) => {
      const instructors = getInstructors(row.original.enrolled as any[]);
      if (!instructors || instructors.length === 0) {
        return <span className="text-muted-foreground italic">None</span>;
      }
      if (instructors.length === 1) {
        const f = instructors[0];
        return `${f.firstName ?? ''} ${f.lastName ?? ''}`.trim();
      }
      const f = instructors[0];
      return `${(f.firstName ?? '') + (f.lastName ? ' ' + f.lastName : '')}`.trim() + ', ...';
    },
  },
  {
    id: 'actions',
    header: '',
    enableSorting: false,
    meta: { priority: 1 },
    cell: ({ row }) => {
      const course = row.original;
      return <CourseActionsCell course={course} onCourseUpdated={onCourseUpdated} onCourseDeleted={onCourseDeleted} />;
    },
  },
];

function CourseActionsCell({ course, onCourseUpdated, onCourseDeleted }: CourseActionsCellProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/courses/${course.id}`, {
        method: 'DELETE',
        body: JSON.stringify(course),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const serverMessage = json?.error || 'Error deleting course';
        throw new Error(serverMessage);
      }
      showToast.success('Course successfully deleted');
      setConfirmOpen(false);
      if (onCourseDeleted) onCourseDeleted();
    } catch (e: any) {
      const msg = e?.message || 'Network error';
      showToast.error(msg);
    } finally {
      setEditOpen(false);
    }
  };

  return (
    <>
      <EditCourseDialog
        course={course}
        open={editOpen}
        setOpen={setEditOpen}
        onSave={async (updatedCourse) => {
          try {
            const res = await fetch(`/api/courses/${updatedCourse.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updatedCourse),
            });
            if (!res.ok) throw new Error('Failed to save course');

            const refreshed = await fetch(`/api/courses/${updatedCourse.id}`).then((r) => r.json());

            onCourseUpdated(refreshed);
            showToast.success('Course updated!');
          } catch {
            showToast.error('Failed to save course');
          } finally {
            setEditOpen(false);
          }
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Delete Course"
        description={`Are you sure you want to delete "${course.name}"? This action cannot be undone.`}
        confirmText="Delete"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            <ChevronDown /> Manage
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            {course.name}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <Link href={`/dashboard/courses/${course.id}`} passHref>
            <DropdownMenuItem className="hover:bg-secondary flex items-center gap-2">
              <BookOpen className="mr-2 h-4 w-4" />
              View Course
            </DropdownMenuItem>
          </Link>
          <DropdownMenuItem
            onClick={() => setEditOpen(true)}
            className="hover:bg-secondary flex items-center gap-2"
            disabled={course.isArchived}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit Course
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setConfirmOpen(true)}
            className="hover:bg-secondary focus:text-red-600 flex items-center gap-2 text-red-600"
            disabled={!course.isArchived}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Archived Course
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
