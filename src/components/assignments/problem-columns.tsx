import React from 'react';
import type { Problem } from '@prisma/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { EllipsisVertical, Pencil, Trash2, NotebookText, Eye, Download } from 'lucide-react';
import { apiPaths } from '@/lib/api-paths';

export const problemTypeLabels: Record<string, string> = {
  FA: 'Finite Automaton',
  PDA: 'Push-Down Automaton',
  CFG: 'Context-Free Grammar',
  RE: 'Regular Expression',
  TM: 'Turing Machine',
};

export type ProblemColumnsParams = {
  /** Archived courses are read-only: Edit/Remove items are hidden. */
  courseIsArchived: boolean;
  openDescription: (problem: Problem) => void;
  openRenderViewer: (problem: Problem) => void;
  handleEditProblem: (problem: Problem) => void;
  onRemoveProblem: (problem: Problem) => void;
};

/**
 * The column model for the assignment's problems table. Extracted from
 * PrivilegeAssignmentView so the ~250-line definition lives (and can be tested) on its
 * own; the view wraps this in a `useMemo`. Pure: every interaction is delegated to a
 * callback passed in `params`.
 */
export function buildProblemColumns(params: ProblemColumnsParams) {
  const {
    courseIsArchived,
    openDescription,
    openRenderViewer,
    handleEditProblem,
    onRemoveProblem,
  } = params;

  return [
    {
      id: 'number',
      header: '#',
      cell: ({ row }: { row: { index: number } }) => row.index + 1,
      meta: { priority: 1 },
      enableSorting: false,
    },
    {
      accessorKey: 'title',
      header: 'Title',
      // The title with a "View description" link underneath. The link opens the
      // description modal; it's omitted when the problem has no description.
      cell: ({ row }: { row: { original: Problem } }) => {
        const problem = row.original;
        // Either form counts as having a description: a rich-only problem still has text to show.
        const hasDescription =
          Boolean(problem.description) ||
          Boolean((problem as { descriptionJson?: unknown }).descriptionJson);
        return (
          <div className="flex flex-col gap-0.5">
            <span>{problem.title}</span>
            {hasDescription ? (
              <button
                type="button"
                onClick={() => openDescription(problem)}
                className="text-primary self-start text-xs underline hover:text-primary/80"
                title="View description"
              >
                View description
              </button>
            ) : null}
          </div>
        );
      },
      meta: { priority: 1 },
      enableSorting: true,
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }: { row: { original: Problem } }) =>
        problemTypeLabels[row.original.type as string] || row.original.type,
      meta: {
        priority: 1,
        filterVariant: 'multiselect' as const,
        filterLabel: 'Type',
        filterOptions: Object.entries(problemTypeLabels).map(([value, label]) => ({ value, label })),
      },
      enableSorting: true,
    },
    {
      accessorKey: 'maxStates',
      header: 'Max States',
      cell: ({ row }: { row: { original: Problem } }) =>
        row.original.maxStates === -1 ? 'Unlimited' : row.original.maxStates,
      meta: { priority: 2 },
      enableSorting: true,
    },
    {
      accessorKey: 'assignmentMaxPoints',
      header: 'Max Points',
      cell: ({ row }: { row: { original: Problem & { assignmentMaxPoints?: number } } }) =>
        typeof row.original.assignmentMaxPoints === 'number'
          ? row.original.assignmentMaxPoints
          : null,
      meta: { priority: 1 },
      enableSorting: true,
    },
    {
      accessorKey: 'assignmentMaxSubmissions',
      header: 'Max Submissions',
      cell: ({ row }: { row: { original: Problem & { assignmentMaxSubmissions?: number } } }) => {
        const value = row.original.assignmentMaxSubmissions;
        if (typeof value !== 'number') return null;
        return value === -1 ? 'Unlimited' : value;
      },
      meta: { priority: 1 },
      enableSorting: true,
      sortingFn: (
        rowA: { getValue: (id: string) => unknown },
        rowB: { getValue: (id: string) => unknown },
        columnId: string,
      ) => {
        const normalize = (val: unknown) => {
          if (typeof val !== 'number') return Number.POSITIVE_INFINITY;
          return val === -1 ? Number.POSITIVE_INFINITY : val;
        };
        const a = normalize(rowA.getValue(columnId));
        const b = normalize(rowB.getValue(columnId));
        return a === b ? 0 : a > b ? 1 : -1;
      },
    },
    {
      accessorKey: 'assignmentAutograderEnabled',
      header: 'Autograder',
      cell: ({
        row,
      }: {
        row: { original: Problem & { assignmentAutograderEnabled?: boolean } };
      }) => {
        const value = row.original.assignmentAutograderEnabled;
        if (typeof value !== 'boolean') return null;
        return value ? 'On' : 'Off';
      },
      meta: {
        priority: 2,
        filterVariant: 'multiselect' as const,
        filterLabel: 'Autograder',
        filterOptions: [
          { label: 'On', value: 'true' },
          { label: 'Off', value: 'false' },
        ],
      },
      enableSorting: true,
      sortingFn: (
        rowA: { getValue: (id: string) => unknown },
        rowB: { getValue: (id: string) => unknown },
        columnId: string,
      ) => {
        const toNumber = (val: unknown) => {
          if (typeof val === 'boolean') return val ? 1 : 0;
          return -1;
        };
        const a = toNumber(rowA.getValue(columnId));
        const b = toNumber(rowB.getValue(columnId));
        return a === b ? 0 : a > b ? 1 : -1;
      },
    },
    {
      accessorKey: 'isDeterministic',
      header: 'Deterministic',
      cell: ({ row }: { row: { original: Problem } }) =>
        row.original.isDeterministic ? 'Yes' : 'No',
      meta: {
        priority: 2,
        filterVariant: 'multiselect' as const,
        filterLabel: 'Deterministic',
        filterOptions: [
          { label: 'Yes', value: 'true' },
          { label: 'No', value: 'false' },
        ],
      },
      enableSorting: true,
    },
    {
      id: 'answerFile',
      header: 'Solution File',
      cell: ({ row }: { row: { original: Problem } }) => {
        const fileUrl = row.original.fileName
          ? apiPaths.files.solution(row.original.fileName, { download: true })
          : null;
        const fileName = row.original.originalFileName || 'solution';
        return fileUrl ? (
          <div className="flex w-full items-center justify-between gap-2">
            {/* Click the name to open the viewer; the icon downloads. */}
            <button
              type="button"
              onClick={() => openRenderViewer(row.original)}
              className="text-primary text-xs break-all hover:underline"
              title={`View ${fileName}`}
            >
              {fileName}
            </button>
            <a
              href={fileUrl}
              download={fileName}
              title={`Download ${fileName}`}
              aria-label={`Download ${fileName} for ${row.original.title}`}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        ) : (
          <span className="text-muted-foreground">No file</span>
        );
      },
      meta: { priority: 2 },
      enableSorting: false,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }: { row: { original: Problem } }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* Every row carries one of these, so the label names the problem: a dozen
                buttons all called "More" is what a screen reader would otherwise hear. */}
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
            <DropdownMenuItem
              onClick={() => handleEditProblem(row.original)}
              className="flex items-center gap-2"
              hidden={courseIsArchived}
            >
              <Pencil className="mr-2 h-4 w-4" /> Edit Problem
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => openRenderViewer(row.original)}
              className="flex items-center gap-2"
            >
              <Eye className="mr-2 h-4 w-4" /> View File
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2"
              disabled={!row.original.fileName}
              onClick={() => {
                const url = row.original.fileName
                  ? apiPaths.files.solution(row.original.fileName, { download: true })
                  : null;
                if (!url) return;
                window.open(url, '_blank', 'noopener,noreferrer');
              }}
            >
              <Download className="mr-2 h-4 w-4" /> Download File
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onRemoveProblem(row.original)}
              className="flex items-center gap-2 text-destructive focus:text-destructive"
              hidden={courseIsArchived}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Remove Problem
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      meta: { priority: 1 },
    },
  ];
}
