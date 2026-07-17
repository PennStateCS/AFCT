'use client';

// problem-columns.tsx
import type { ColumnDef } from '@tanstack/react-table';
import type { Problem } from '@prisma/client';
import { useState, type JSX } from 'react';
import { ChevronDown, Pencil, Trash2, FileText, Eye } from 'lucide-react';
import { Badge as StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import JffViewerDialog from '@/components/JffViewerDialog';
import { useEmptyStringSymbol } from '@/lib/useEmptyStringSymbol';
import { RegexViewerDialog } from '@/components/dialogs/RegexViewerDialog';
import { CfgViewerDialog } from '@/components/dialogs/CfgViewerDialog';
import { formatDateInTimeZone } from '@/lib/date';
import { apiPaths } from '@/lib/api-paths';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

const typeLabels: Record<string, string> = {
  FA: 'Finite Automaton',
  PDA: 'Push-Down Automaton',
  CFG: 'Context-Free Grammar',
  RE: 'Regular Expression',
  TM: 'Turing Machine',
};

export const useProblemColumns = ({
  courseIsArchived,
  onEdit,
  onDelete,
  timeZone,
}: {
  onEdit: (p: Problem) => void;
  onDelete: (id: string) => void;
  courseIsArchived: boolean;
  timeZone: string;
}): { columns: ColumnDef<Problem>[]; viewDialog: JSX.Element | null } => {
  const [openDialog, setOpenDialog] = useState<{ open: boolean; problem: Problem | null }>({
    open: false,
    problem: null,
  });
  const epsSymbol = useEmptyStringSymbol(openDialog.problem?.courseId);

  const columns: ColumnDef<Problem>[] = [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => {
        const problemWithMeta = row.original as Problem & { usedByAssignment?: boolean };
        return (
          <div className="flex items-center gap-2">
            <span>{row.original.title}</span>
            {problemWithMeta.usedByAssignment ? (
              <StatusBadge variant="warning">Used</StatusBadge>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: 'type',
      header: 'Type',
      meta: {
        filterVariant: 'multiselect',
        filterLabel: 'Type',
        filterOptions: Object.entries(typeLabels).map(([value, label]) => ({ value, label })),
      },
      cell: ({ row }) =>
        row.original.type ? typeLabels[row.original.type] || row.original.type : 'Unknown',
    },
    {
      accessorKey: 'originalFileName',
      header: 'File',
      cell: ({ row }) => {
        const file = row.original.originalFileName;
        const fileName = row.original.fileName;
        if (!file || !fileName) return '—';
        return (
          <a
            href={apiPaths.files.solution(fileName, { download: true })}
            download={file}
            className="text-sm break-all text-blue-600 hover:underline"
          >
            {file}
          </a>
        );
      },
    },
    {
      accessorKey: 'maxStates',
      header: 'Max States',
      cell: ({ row }) => {
        const value = row.original.maxStates;
        return value === -1 ? 'Unlimited' : (value ?? '—');
      },
    },
    {
      id: 'isDeterministic',
      header: 'Deterministic',
      // Derive the displayed value so sorting and the value filter match what's shown
      // (only Finite Automata carry a meaningful determinism flag).
      accessorFn: (row) => (row.type === 'FA' ? (row.isDeterministic ? 'Yes' : 'No') : '—'),
      meta: {
        filterVariant: 'multiselect',
        filterLabel: 'Deterministic',
        filterOptions: [
          { label: 'Yes', value: 'Yes' },
          { label: 'No', value: 'No' },
          { label: 'N/A', value: '—' },
        ],
      },
      cell: ({ row }) =>
        row.original.type === 'FA' ? (row.original.isDeterministic ? 'Yes' : 'No') : '—',
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ row }) => formatDateInTimeZone(row.original.createdAt, timeZone),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const problemWithMeta = row.original as Problem & { usedByAssignment?: boolean };
        const disabled = Boolean(problemWithMeta.usedByAssignment);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" aria-label={`Manage problem ${row.original.title}`}>
                <ChevronDown />
                Manage
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {row.original.title}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  if (!row.original.fileName) return;
                  setOpenDialog({ open: true, problem: row.original });
                }}
                className="flex items-center gap-2"
                disabled={!row.original.fileName}
              >
                <Eye className="mr-2 h-4 w-4" />
                View Answer
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onEdit(row.original)}
                className="flex items-center gap-2"
                hidden={courseIsArchived}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit Problem
              </DropdownMenuItem>
              <DropdownMenuSeparator hidden={courseIsArchived} />
              <DropdownMenuItem
                onClick={() => {
                  if (disabled) return;
                  onDelete(problemWithMeta.id);
                }}
                disabled={disabled}
                hidden={courseIsArchived}
                title={
                  disabled ? 'Problem is used by an assignment and cannot be deleted' : undefined
                }
                className={`flex items-center gap-2 text-red-600 focus:text-red-600 ${
                  disabled ? 'cursor-not-allowed opacity-50' : ''
                }`}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Problem
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const viewDialog = (() => {
    if (!openDialog.problem) return null;
    switch (openDialog.problem.type) {
      case 'FA':
      case 'PDA':
      case 'TM':
        return (
          <JffViewerDialog
            open={openDialog.open}
            onOpenChange={(open) =>
              setOpenDialog({ open, problem: open ? openDialog.problem : null })
            }
            src={apiPaths.files.solution(encodeURIComponent(openDialog.problem.fileName ?? ''))}
            title={`${openDialog.problem.originalFileName || openDialog.problem.fileName} - Problem`}
            width="70vw"
            height="70vh"
            epsSymbol={epsSymbol}
          />
        );
      case 'RE':
        return (
          <RegexViewerDialog
            open={openDialog.open}
            onOpenChange={(open) =>
              setOpenDialog({ open, problem: open ? openDialog.problem : null })
            }
            src={apiPaths.files.solution(encodeURIComponent(openDialog.problem.fileName ?? ''))}
            title={`${openDialog.problem.originalFileName || openDialog.problem.fileName} - Problem`}
          />
        );
      case 'CFG':
        return (
          <CfgViewerDialog
            open={openDialog.open}
            onOpenChange={(open) =>
              setOpenDialog({ open, problem: open ? openDialog.problem : null })
            }
            src={apiPaths.files.solution(encodeURIComponent(openDialog.problem.fileName ?? ''))}
            title={`${openDialog.problem.originalFileName || openDialog.problem.fileName} - Problem`}
          />
        );
      default:
        return null;
    }
  })();
  return { columns, viewDialog };
};
