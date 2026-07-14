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
import { ChevronDown, Pencil, Trash2, NotebookText, Eye, Download } from 'lucide-react';
import { apiPaths } from '@/lib/api-paths';

export const problemTypeLabels: Record<string, string> = {
  FA: 'Finite Automaton',
  PDA: 'Push-Down Automaton',
  CFG: 'Context-Free Grammar',
  RE: 'Regular Expression',
  TM: 'Turing Machine',
};

export type ProblemColumnsParams = {
  /** Whether this is a group assignment; controls the Group column's presence. */
  isGroup: boolean;
  /** Group display names per problem id (empty = "All students"). */
  groupNamesByProblemId: Record<string, string[]>;
  /** Archived courses are read-only: Edit/Remove items are hidden. */
  courseIsArchived: boolean;
  openDescription: (desc: string) => void;
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
    isGroup,
    groupNamesByProblemId,
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
      cell: ({ row }: { row: { original: Problem } }) => row.original.title,
      meta: { priority: 1 },
      enableSorting: true,
    },
    {
      id: 'description_col',
      header: 'Description',
      cell: ({ row }: { row: { original: Problem } }) => {
        const desc = row.original.description;
        return desc ? (
          <button
            type="button"
            onClick={() => openDescription(desc)}
            className="text-blue-600 underline hover:text-blue-800"
            title="View description"
          >
            View Description
          </button>
        ) : (
          <span className="text-muted-foreground text-xs">â€”</span>
        );
      },
      meta: { priority: 2 },
      enableSorting: false,
    },
    // Group column: only present for group assignments
    ...(isGroup
      ? [
          {
            id: 'group',
            header: 'Group',
            cell: ({ row }: { row: { original: Problem } }) => {
              const pid = row.original.id;
              const names = groupNamesByProblemId[pid] ?? [];

              if (names.length === 0) return <span title="All students">All students</span>;

              if (names.length === 1)
                return (
                  <span className="truncate" title={names[0]}>
                    {names[0]}
                  </span>
                );
              return (
                <span className="truncate" title={names.join(', ')}>
                  {names[0]} (+{names.length - 1})
                </span>
              );
            },
            meta: { priority: 2 },
            enableSorting: false,
          },
        ]
      : []),
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }: { row: { original: Problem } }) =>
        problemTypeLabels[row.original.type as string] || row.original.type,
      meta: { priority: 1 },
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
          : 'â€”',
      meta: { priority: 1 },
      enableSorting: true,
    },
    {
      accessorKey: 'assignmentMaxSubmissions',
      header: 'Max Submissions',
      cell: ({ row }: { row: { original: Problem & { assignmentMaxSubmissions?: number } } }) => {
        const value = row.original.assignmentMaxSubmissions;
        if (typeof value !== 'number') return 'â€”';
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
        if (typeof value !== 'boolean') return 'â€”';
        return value ? 'On' : 'Off';
      },
      meta: { priority: 2 },
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
      meta: { priority: 2 },
      enableSorting: true,
    },
    {
      id: 'answerFile',
      header: 'Solution File',
      cell: ({ row }: { row: { original: Problem } }) => {
        const fileUrl = row.original.fileName
          ? apiPaths.files.solution(row.original.fileName, { download: true })
          : null;
        const fileName = row.original.originalFileName || 'Download';
        return fileUrl ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openRenderViewer(row.original)}
              title="Render file"
              aria-label={`Render file for ${row.original.title}`}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a
                href={fileUrl}
                download={fileName}
                title={`Download ${fileName}`}
                aria-label={`Download ${fileName} for ${row.original.title}`}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
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
            <Button variant="secondary" size="sm" aria-label={`Manage problem ${row.original.title}`}>
              <ChevronDown className="mr-1 h-4 w-4" /> Manage
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
              className="flex items-center gap-2 text-red-600 focus:text-red-600"
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
