'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { AssignmentWithProblemCount } from '@/types/course';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { NotebookText, Trash2, ChevronDown, BookOpen, CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { CompactDate } from '@/components/ui/CompactDate';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { AssignmentOverrideSummary } from '@/types/course';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { fetchJson } from '@/lib/query-fetch';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

// Lazily fetches the assignment's max points when the row doesn't already have it.
// Shares the assignment.shell cache entry with StudentAssignmentView/StudentNavigator,
// so multiple rows (and other views) hitting the assignment endpoint dedupe to one request.
export function MaxPointsCell({
  courseId,
  assignmentId,
  maxPoints,
}: {
  courseId: string;
  assignmentId: string;
  maxPoints: number | null;
}) {
  const needsFetch = maxPoints === null || maxPoints === undefined;

  const { data } = useQuery({
    queryKey: queryKeys.assignment.shell(courseId, assignmentId),
    queryFn: () =>
      fetchJson<{ maxPoints: number | null }>(
        apiPaths.assignment(courseId, assignmentId, { view: 'problems' }),
      ),
    enabled: needsFetch,
    staleTime: 30_000,
  });

  const pts = needsFetch ? (data ? (data.maxPoints ?? 0) : null) : maxPoints;

  return <div>{pts !== null ? pts : '...'}</div>;
}

// Due date cell that shows the base date plus, when the assignment has per-student
// overrides, a "+N" badge opening a popover with each student's effective window.
export function DueDateCell({
  assignment,
  timeZone,
}: {
  assignment: AssignmentWithProblemCount;
  timeZone: string;
}) {
  const overrides = assignment.overrides ?? [];
  const everyoneLabel = assignment.assignedToEveryone === false ? 'Everyone else' : 'Everyone';

  return (
    <div className="flex items-center gap-1.5">
      <CompactDate value={assignment.dueDate} timeZone={timeZone} />
      {overrides.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 focus-visible:ring-ring/40 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-none font-medium focus-visible:ring-[3px] focus-visible:outline-none"
              aria-label={`Multiple due dates (${overrides.length} override${overrides.length === 1 ? '' : 's'}); show details`}
            >
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
              Multiple
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-3 text-xs">
            <p className="mb-2 font-medium">Due dates</p>
            <ul className="space-y-2">
              <li className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground truncate">{everyoneLabel}</span>
                <span className="shrink-0">
                  <CompactDate value={assignment.dueDate} timeZone={timeZone} />
                </span>
              </li>
              {overrides.map((o: AssignmentOverrideSummary, i) => {
                const effDue = o.dueDate ?? assignment.dueDate;
                const effAllowLate = o.allowLateSubmissions ?? assignment.allowLateSubmissions;
                const effCutoff = effAllowLate ? (o.lateCutoff ?? assignment.lateCutoff) : null;
                return (
                  <li key={i} className="flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-medium">{o.studentName}</span>
                      <span className="shrink-0">
                        <CompactDate value={effDue} timeZone={timeZone} />
                      </span>
                    </div>
                    {effCutoff && (
                      <span className="text-muted-foreground">
                        late until <CompactDate value={effCutoff} timeZone={timeZone} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
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
      cell: ({ row }) => <DueDateCell assignment={row.original} timeZone={timeZone} />,
    },
    {
      accessorKey: 'maxPoints',
      header: () => 'Points',
      meta: { priority: 2 },
      cell: ({ row }) => (
        <MaxPointsCell
          courseId={row.original.courseId}
          assignmentId={row.original.id}
          maxPoints={row.original.maxPoints ?? null}
        />
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
      meta: { priority: 3, filterVariant: 'multiselect', filterLabel: 'Allow Late' },
    },
    {
      accessorKey: 'lateCutoff',
      header: 'Late Cutoff',
      cell: ({ row }) => <CompactDate value={row.original.lateCutoff} timeZone={timeZone} />,
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
      meta: {
        filterVariant: 'multiselect',
        filterLabel: 'Published',
        filterOptions: [
          { label: 'Published', value: 'true' },
          { label: 'Unpublished', value: 'false' },
        ],
      },
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
