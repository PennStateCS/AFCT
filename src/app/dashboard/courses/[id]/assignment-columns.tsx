'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Assignment } from '@prisma/client';
import type { AssignmentWithProblemCount } from '@/types/course';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { NotebookText, Pencil, Trash2, ChevronDown, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { formatDateTimeInTimeZone } from '@/lib/date';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

// Lazily fetches the assignment's max points when the row doesn't already have it.
// Shares the ['assignment', id] cache entry with StudentAssignmentView/StudentNavigator,
// so multiple rows (and other views) hitting /api/assignments/{id} dedupe to one request.
export function MaxPointsCell({
  assignmentId,
  maxPoints,
}: {
  assignmentId: string;
  maxPoints: number | null;
}) {
  const needsFetch = maxPoints === null || maxPoints === undefined;

  const { data } = useQuery({
    queryKey: ['assignment', assignmentId],
    queryFn: async () => {
      const res = await fetch(`/api/assignments/${assignmentId}`);
      if (!res.ok) throw new Error('Failed to fetch assignment');
      return (await res.json()) as { maxPoints: number | null };
    },
    enabled: needsFetch,
    staleTime: 30_000,
  });

  const pts = needsFetch ? (data ? data.maxPoints ?? 0 : null) : maxPoints;

  return <div>{pts !== null ? pts : '...'}</div>;
}

// Component for the publish switch with confirmation dialog
function PublishSwitchCell({
  assignment,
  onPublishToggle,
  disabled,
}: {
  assignment: AssignmentWithProblemCount;
  onPublishToggle: (assignmentId: string, newValue: boolean) => void;
  disabled: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState(false);

  const handleSwitchChange = (checked: boolean) => {
    if (disabled) return;
    setPendingValue(checked);
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    onPublishToggle(assignment.id, pendingValue);
    setConfirmOpen(false);
  };

  const handleCancel = () => {
    setConfirmOpen(false);
  };

  const action = pendingValue ? 'publish' : 'unpublish';
  const description = `Are you sure you want to ${action} "${assignment.title}"? This will ${pendingValue ? 'make it visible to students' : 'hide it from students'}.`;

  return (
    <>
      <Switch
        checked={assignment.isPublished}
        onCheckedChange={handleSwitchChange}
        disabled={disabled}
        aria-label={`Toggle publish for ${assignment.title}`}
      />
      <ConfirmDialog
        open={confirmOpen}
        title={`${action.charAt(0).toUpperCase() + action.slice(1)} Assignment`}
        description={description}
        confirmText={action.charAt(0).toUpperCase() + action.slice(1)}
        cancelText="Cancel"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}

export function useAssignmentColumns(
  courseIsArchived: boolean,
  handleAssignmentDeleteClick: (id: string) => void,
  handleAssignmentEditClick: (assignment: Assignment) => void,
  handlePublishToggle: (assignmentId: string, newValue: boolean) => void,
  timeZone: string,
): ColumnDef<AssignmentWithProblemCount>[] {
  return [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <div className="min-w-0">
          <Link
            href={`/dashboard/courses/${row.original.courseId}/${row.original.id}`}
            className="block max-w-[8rem] truncate text-blue-600 hover:underline sm:max-w-[12rem] lg:max-w-[16rem]"
            title={row.original.title}
          >
            {row.original.title}
          </Link>
        </div>
      ),
    },
    {
      accessorKey: 'dueDate',
      header: 'Due Date',
      cell: ({ row }) => <div>{formatDateTimeInTimeZone(row.original.dueDate, timeZone)}</div>,
    },
    {
      accessorKey: 'maxPoints',
      header: () => 'Points',
      meta: { priority: 2 },
      cell: ({ row }) => (
        <MaxPointsCell assignmentId={row.original.id} maxPoints={row.original.maxPoints ?? null} />
      ),
    },
    {
      id: 'problemCount',
      header: 'Problems',
      accessorKey: 'problemCount',
      cell: ({ row }) => {
        const count = row.original.problemCount ?? 0;
        return <div>{count}</div>;
      },
      enableSorting: true,
      meta: { priority: 2 },
    },
    {
      id: 'allowLateSubmissions',
      header: 'Allow Late',
      accessorFn: (row) => (row.allowLateSubmissions ? 'Yes' : 'No'),
      cell: ({ row }) => <div>{row.original.allowLateSubmissions ? 'Yes' : 'No'}</div>,
      enableSorting: true,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'lateCutoff',
      header: 'Late Cutoff',
      cell: ({ row }) => (
        <div>
          {row.original.lateCutoff
            ? formatDateTimeInTimeZone(row.original.lateCutoff, timeZone)
            : '—'}
        </div>
      ),
      meta: { priority: 4 },
    },
    {
      id: 'submissionCount',
      header: 'Submissions',
      accessorKey: 'submissionCount',
      cell: ({ row }) => <div>{row.original.submissionCount ?? 0}</div>,
      enableSorting: true,
      meta: { priority: 3 },
    },
    {
      id: 'commentCount',
      header: 'Comments',
      accessorKey: 'commentCount',
      cell: ({ row }) => <div>{row.original.commentCount ?? 0}</div>,
      enableSorting: true,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'isPublished',
      header: 'Published',
      cell: ({ row }) => (
        <PublishSwitchCell
          assignment={row.original}
          onPublishToggle={handlePublishToggle}
          disabled={courseIsArchived}
        />
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const disabled = !!row.original.hasSubmissionsOrComments || courseIsArchived;
        const title = disabled ? 'Cannot delete' : undefined;

        return (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" aria-label={`Manage assignment ${row.original.title}`}>
                  <ChevronDown />
                  Manage
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="flex items-center gap-2">
                  <NotebookText className="h-4 w-4" />
                  {row.original.title}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="flex items-center gap-2">
                  <Link href={`/dashboard/courses/${row.original.courseId}/${row.original.id}`}>
                    <BookOpen className="mr-2 h-4 w-4" />
                    View Assignment
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleAssignmentEditClick(row.original)}
                  className="flex items-center gap-2"
                  hidden={courseIsArchived}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit Assignment
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => {
                    if (disabled) return;
                    handleAssignmentDeleteClick(row.original.id);
                  }}
                  hidden={courseIsArchived}
                  title={title}
                  className={`flex items-center gap-2 ${disabled ? 'cursor-not-allowed text-gray-500 opacity-50' : 'text-red-600 focus:text-red-600'}`}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete Assignment
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        );
      },
    },
  ];
}
