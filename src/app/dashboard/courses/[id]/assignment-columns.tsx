'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { AssignmentWithProblemCount } from '@/types/course';
import { RichDescription } from '@/components/rich-description/RichDescription';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  NotebookText,
  Trash2,
  ChevronDown,
  EllipsisVertical,
  BookOpen,
  CalendarClock,
  Copy,
  Package,
  BarChart3,
  Fingerprint,
} from 'lucide-react';
import type { DuplicateSourceAssignment } from '@/components/dialogs/DuplicateAssignmentDialog';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { CompactDate } from '@/components/ui/CompactDate';
import { parseValidDate } from '@/lib/date-format';
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
import { TEXT_LINK_CLASS } from '@/lib/link-styles';
import { cn } from '@/lib/utils';

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
    <div className="flex flex-col items-start gap-1">
      {/* With per-student overrides the single base date is misleading, so show only
          the badge; its popover lists every effective date. */}
      {overrides.length === 0 ? (
        <CompactDate value={assignment.dueDate} timeZone={timeZone} />
      ) : (
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

// The unlock date, late policy, and late cutoff can each be overridden per student.
// When an assignment's effective values for one of those fields actually differ across
// the roster we hide the single base value (which would be misleading) and show the
// same "Multiple" badge the due date uses, with a popover breaking the value down by
// student. This is the field the cell renders.
type OverrideField = 'unlockAt' | 'allowLateSubmissions' | 'lateCutoff';

// The value that actually applies for a given field: `o` null means the base "everyone"
// row; an override falls back to the base when it doesn't set the field. The late cutoff
// only applies when late submissions are allowed (matching the due-date popover).
function effectiveFieldValue(
  assignment: AssignmentWithProblemCount,
  o: AssignmentOverrideSummary | null,
  field: OverrideField,
): Date | string | boolean | null {
  const effAllowLate = o?.allowLateSubmissions ?? assignment.allowLateSubmissions ?? false;
  switch (field) {
    case 'unlockAt':
      return o?.unlockAt ?? assignment.unlockAt ?? null;
    case 'allowLateSubmissions':
      return effAllowLate;
    case 'lateCutoff':
      return effAllowLate ? (o?.lateCutoff ?? assignment.lateCutoff ?? null) : null;
  }
}

// A comparable key so we can tell whether the effective values genuinely differ. Dates
// (Date or ISO string) collapse to their timestamp; null is its own bucket.
function fieldValueKey(value: Date | string | boolean | null): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const parsed = parseValidDate(value);
  return parsed ? String(parsed.getTime()) : String(value);
}

function renderFieldValue(
  field: OverrideField,
  value: Date | string | boolean | null,
  timeZone: string,
) {
  if (field === 'allowLateSubmissions') {
    return <span>{value ? 'Yes' : 'No'}</span>;
  }
  return <CompactDate value={value as Date | string | null} timeZone={timeZone} />;
}

export function OverrideAwareCell({
  assignment,
  timeZone,
  field,
  label,
}: {
  assignment: AssignmentWithProblemCount;
  timeZone: string;
  field: OverrideField;
  label: string;
}) {
  const overrides = assignment.overrides ?? [];
  const everyoneLabel = assignment.assignedToEveryone === false ? 'Everyone else' : 'Everyone';

  const baseValue = effectiveFieldValue(assignment, null, field);
  const rows = [
    { name: everyoneLabel, value: baseValue },
    ...overrides.map((o) => ({
      name: o.studentName,
      value: effectiveFieldValue(assignment, o, field),
    })),
  ];
  const distinct = new Set(rows.map((r) => fieldValueKey(r.value)));
  const isMultiple = overrides.length > 0 && distinct.size > 1;

  if (!isMultiple) {
    return renderFieldValue(field, baseValue, timeZone);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 focus-visible:ring-ring/40 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-none font-medium focus-visible:ring-[3px] focus-visible:outline-none"
          aria-label={`Multiple ${label.toLowerCase()} values; show details`}
        >
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          Multiple
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 text-xs">
        <p className="mb-2 font-medium">{label}</p>
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <span className={`truncate ${i === 0 ? 'text-muted-foreground' : 'font-medium'}`}>
                {r.name}
              </span>
              <span className="shrink-0">{renderFieldValue(field, r.value, timeZone)}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
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

  const description = `"${assignment.title}" will ${pendingValue ? 'become visible to students' : 'be hidden from students'}.`;

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
        title={pendingValue ? 'Publish assignment?' : 'Unpublish assignment?'}
        description={description}
        confirmText={pendingValue ? 'Publish' : 'Unpublish'}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}

// The assignment title (a link to its page) plus a "View description" link that opens
// a read-only modal. Self-contained so each row owns its own modal state without the
// column model threading dialog state through the table.
function AssignmentTitleCell({ assignment }: { assignment: AssignmentWithProblemCount }) {
  const [descOpen, setDescOpen] = useState(false);
  // Either form counts: a rich-only assignment still has something to show. (In practice the
  // plain text is always derived on save, so this mainly guards records written another way.)
  const hasDescription = Boolean(assignment.description) || Boolean(assignment.descriptionJson);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Link
        href={`/dashboard/courses/${assignment.courseId}/${assignment.id}`}
        className={cn(
          TEXT_LINK_CLASS,
          'block max-w-[8rem] truncate sm:max-w-[12rem] lg:max-w-[16rem]',
        )}
        title={assignment.title}
      >
        {assignment.title}
      </Link>
      {hasDescription ? (
        <>
          <button
            type="button"
            onClick={() => setDescOpen(true)}
            className={cn(TEXT_LINK_CLASS, 'self-start text-xs')}
            title="View description"
          >
            View description
          </button>
          <Dialog open={descOpen} onOpenChange={setDescOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assignment Description</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {assignment.title}
                </DialogDescription>
              </DialogHeader>
              {/* Focusable so a long description can be scrolled without a mouse. */}
              <div
                className="max-h-[60vh] overflow-y-auto rounded-md border p-3 text-sm"
                tabIndex={0}
                role="group"
                aria-label="Description"
              >
                <RichDescription
                  // Heading base: dialog title is an h2, so the description starts one level below it.
                  headingBaseLevel={3}
                  description={assignment.description}
                  descriptionJson={assignment.descriptionJson}
                  compact
                />
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

export function useAssignmentColumns(
  courseIsArchived: boolean,
  handleAssignmentDeleteClick: (id: string) => void,
  handlePublishToggle: (assignmentId: string, newValue: boolean) => void,
  timeZone: string,
  onDuplicate?: (assignment: DuplicateSourceAssignment) => void,
): ColumnDef<AssignmentWithProblemCount>[] {
  return [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => <AssignmentTitleCell assignment={row.original} />,
    },
    {
      id: 'isGroup',
      header: 'Type',
      accessorFn: (row) => (row.isGroup ? 'Group' : 'Individual'),
      cell: ({ row }) => <div>{row.original.isGroup ? 'Group' : 'Individual'}</div>,
      enableSorting: true,
      meta: { priority: 2, filterVariant: 'multiselect', filterLabel: 'Type' },
    },
    {
      accessorKey: 'dueDate',
      header: 'Due Date',
      cell: ({ row }) => <DueDateCell assignment={row.original} timeZone={timeZone} />,
    },
    {
      accessorKey: 'unlockAt',
      header: 'Available From',
      cell: ({ row }) => (
        <OverrideAwareCell
          assignment={row.original}
          timeZone={timeZone}
          field="unlockAt"
          label="Available From"
        />
      ),
      meta: { priority: 3 },
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
      cell: ({ row }) => (
        <OverrideAwareCell
          assignment={row.original}
          timeZone={timeZone}
          field="allowLateSubmissions"
          label="Allow Late"
        />
      ),
      enableSorting: true,
      meta: { priority: 3, filterVariant: 'multiselect', filterLabel: 'Allow Late' },
    },
    {
      accessorKey: 'lateCutoff',
      header: 'Late Cutoff',
      cell: ({ row }) => (
        <OverrideAwareCell
          assignment={row.original}
          timeZone={timeZone}
          field="lateCutoff"
          label="Late Cutoff"
        />
      ),
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
      // Visible now rather than sr-only: the trigger used to say "Manage" on its face, so
      // the column named itself. A bare ellipsis does not.
      header: 'Actions',
      cell: ({ row }) => {
        const disabled = !!row.original.hasSubmissionsOrComments || courseIsArchived;
        const title = disabled ? 'Cannot delete' : undefined;

        return (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Actions for ${row.original.title}`}
                >
                  <EllipsisVertical className="h-4 w-4" />
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
                {/* Deep links to the assignment's tabs (the ?tab= param the assignment page reads). */}
                <DropdownMenuItem asChild className="flex items-center gap-2">
                  <Link
                    href={`/dashboard/courses/${row.original.courseId}/${row.original.id}?tab=submissions`}
                  >
                    <Package className="mr-2 h-4 w-4" />
                    Submissions
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="flex items-center gap-2">
                  <Link
                    href={`/dashboard/courses/${row.original.courseId}/${row.original.id}?tab=statistics`}
                  >
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Statistics
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="flex items-center gap-2">
                  <Link
                    href={`/dashboard/courses/${row.original.courseId}/${row.original.id}?tab=similarity`}
                  >
                    <Fingerprint className="mr-2 h-4 w-4" />
                    Similarity
                  </Link>
                </DropdownMenuItem>
                {onDuplicate && !courseIsArchived && (
                  <DropdownMenuItem
                    onClick={() =>
                      onDuplicate({
                        id: row.original.id,
                        title: row.original.title,
                        description: row.original.description,
                        descriptionJson: row.original.descriptionJson,
                        isGroup: row.original.isGroup,
                        problemCount: row.original.problemCount,
                      })
                    }
                    className="flex items-center gap-2"
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate Assignment
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => {
                    if (disabled) return;
                    handleAssignmentDeleteClick(row.original.id);
                  }}
                  hidden={courseIsArchived}
                  title={title}
                  className={`flex items-center gap-2 ${disabled ? 'text-muted-foreground cursor-not-allowed opacity-50' : 'text-destructive focus:text-destructive'}`}
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
