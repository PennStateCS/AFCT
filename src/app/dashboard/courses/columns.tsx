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
import { toast } from 'sonner';
import { ColumnDef } from '@tanstack/react-table';
import { Pencil, Trash2, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';
import { useState } from 'react';
import { Course } from '@prisma/client';
import { EditCourseDialog } from '@/components/dialogs/EditCourseDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

type CourseWithFaculty = Course & {
  faculty: { firstName: string | null; lastName: string | null }[];
};

export const columns = (
  onCourseUpdated: (updated: CourseWithFaculty) => void,
): ColumnDef<CourseWithFaculty>[] => [
  {
    accessorKey: 'name',
    meta: { priority: 1 },
    header: 'Name',
    cell: ({ row }) => {
      const course = row.original;
      return (
        <Link href={`/dashboard/courses/${course.id}`} className="text-blue-700 hover:underline">
          {course.name}
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
      return format(date, "M/d/yyyy 'at' p");
    },
  },
  {
    accessorKey: 'endDate',
    meta: { priority: 4 },
    header: 'End Date',
    cell: ({ row }) => {
      const date = new Date(row.original.endDate);
      return format(date, "M/d/yyyy 'at' p");
    },
  },
  {
    id: 'faculty',
    accessorFn: (row) =>
      row.faculty.map((f) => `${f.firstName ?? ''} ${f.lastName ?? ''}`.trim()).join(', '),
    meta: { priority: 1 },
    enableSorting: true,
    header: 'Faculty',
    cell: ({ row }) => {
      const facultyList = row.original.faculty;
      if (!facultyList || facultyList.length === 0) {
        return <span className="text-muted-foreground italic">None</span>;
      }
      return facultyList.map((f) => `${f.firstName ?? ''} ${f.lastName ?? ''}`.trim()).join(', ');
    },
  },
  {
    id: 'actions',
    header: '',
    enableSorting: false,
    meta: { priority: 1 },
    cell: ({ row }) => {
      const course = row.original;
      const [editOpen, setEditOpen] = useState(false);
      const [confirmOpen, setConfirmOpen] = useState(false);

      const handleDelete = async () => {
        try {
          const res = await fetch(`/api/courses/${course.id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Delete failed');
          toast.success('Course deleted');
          setConfirmOpen(false);
        } catch (err) {
          toast.error('Failed to delete course');
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

                const refreshed = await fetch(`/api/courses/${updatedCourse.id}`).then((r) =>
                  r.json(),
                );

                onCourseUpdated(refreshed);
                toast.success('Course updated!');
              } catch (err) {
                toast.error('Failed to save course');
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
              <Button variant="secondary">Manage</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                {course.name}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <Link href={`/dashboard/courses/${course.id}`} passHref>
                <DropdownMenuItem className="hover:bg-secondary focus:bg-secondary flex items-center gap-2">
                  <BookOpen className="mr-2 h-4 w-4" />
                  View Course
                </DropdownMenuItem>
              </Link>
              <DropdownMenuItem
                onClick={() => setEditOpen(true)}
                className="hover:bg-secondary focus:bg-secondary flex items-center gap-2"
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit Course
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setConfirmOpen(true)}
                className="hover:bg-secondary focus:bg-secondary flex items-center gap-2 text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Course
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      );
    },
  },
];
