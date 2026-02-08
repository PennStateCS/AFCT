'use client';

// problem-columns.tsx
import { ColumnDef } from '@tanstack/react-table';
import type { Problem } from '@prisma/client';
import { useState } from 'react';
import { ChevronDown, Pencil, Trash2, FileText, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/RoleBadge';
import { Button } from '@/components/ui/button';
import JffViewerDialog from '@/components/JffViewerDialog';
import { formatDateInTimeZone } from '@/lib/date';
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
              <Badge variant="outline" className="bg-amber-600 px-2 py-0 text-xs text-white">
                Used
              </Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: 'type',
      header: 'Type',
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
            href={`/api/solutions/${fileName}?download=1`}
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
      accessorKey: 'isDeterministic',
      header: 'Deterministic',
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
      header: '',
      cell: ({ row }) => {
        const problemWithMeta = row.original as Problem & { usedByAssignment?: boolean };
        const disabled = Boolean(problemWithMeta.usedByAssignment);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">
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

  const viewDialog = openDialog.problem ? (
    <JffViewerDialog
      open={openDialog.open}
      onOpenChange={(open) => setOpenDialog({ open, problem: open ? openDialog.problem : null })}
      src={`/api/solutions/${encodeURIComponent(openDialog.problem.fileName ?? '')}`}
      title={`${openDialog.problem.originalFileName || openDialog.problem.fileName} - Problem`}
      width="70vw"
      height="70vh"
    />
  ) : null;

  return { columns, viewDialog };
};
