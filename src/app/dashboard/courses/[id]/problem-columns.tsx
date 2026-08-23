'use client';

// problem-columns.tsx
import type { ColumnDef } from '@tanstack/react-table';
import type { Problem } from '@prisma/client';
import { useState, type JSX } from 'react';
import { EllipsisVertical, Copy, Pencil, Trash2, FileText, Eye, Download } from 'lucide-react';
import type { DuplicateSourceProblem } from '@/components/dialogs/DuplicateProblemDialog';
import { Badge as StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import JffViewerDialog from '@/components/JffViewerDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useEmptyStringSymbol } from '@/hooks/use-empty-string-symbol';
import { RegexViewerDialog } from '@/components/dialogs/RegexViewerDialog';
import { CfgViewerDialog } from '@/components/dialogs/CfgViewerDialog';
import { formatDateInTimeZone } from '@/lib/date-format';
import { apiPaths } from '@/lib/api-paths';
import { RichDescription } from '@/components/rich-description/RichDescription';
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
  onDuplicate,
  timeZone,
}: {
  onEdit: (p: Problem) => void;
  onDelete: (id: string) => void;
  onDuplicate?: (p: DuplicateSourceProblem) => void;
  courseIsArchived: boolean;
  timeZone: string;
}): { columns: ColumnDef<Problem>[]; viewDialog: JSX.Element | null } => {
  const [openDialog, setOpenDialog] = useState<{ open: boolean; problem: Problem | null }>({
    open: false,
    problem: null,
  });
  // Separate state for the read-only description modal opened from the title cell.
  const [descDialog, setDescDialog] = useState<{ open: boolean; problem: Problem | null }>({
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
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span>{row.original.title}</span>
              {problemWithMeta.usedByAssignment ? (
                <StatusBadge variant="warning">Used</StatusBadge>
              ) : null}
            </div>
            {/* Either form counts: a rich-only problem still has text to show. */}
            {row.original.description ||
            (row.original as { descriptionJson?: unknown }).descriptionJson ? (
              <button
                type="button"
                onClick={() => setDescDialog({ open: true, problem: row.original })}
                className="text-link hover:text-link-hover self-start text-xs underline"
                title="View description"
              >
                View description
              </button>
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
      header: 'Solution',
      cell: ({ row }) => {
        const file = row.original.originalFileName;
        const fileName = row.original.fileName;
        if (!file || !fileName) return '—';
        return (
          <div className="flex w-full items-center justify-between gap-2">
            {/* Click the name to open the viewer; the icon downloads. */}
            <button
              type="button"
              onClick={() => setOpenDialog({ open: true, problem: row.original })}
              className="text-link hover:text-link-hover text-xs break-all hover:underline"
              title={`View ${file}`}
            >
              {file}
            </button>
            <a
              href={apiPaths.files.solution(fileName, { download: true })}
              download={file}
              title={`Download ${file}`}
              aria-label={`Download ${file}`}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
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
      // Visible now rather than sr-only: the trigger used to say "Manage" on its face, so
      // the column named itself. A bare ellipsis does not.
      header: 'Actions',
      cell: ({ row }) => {
        const problemWithMeta = row.original as Problem & { usedByAssignment?: boolean };
        const disabled = Boolean(problemWithMeta.usedByAssignment);
        return (
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
              {onDuplicate && !courseIsArchived && (
                <DropdownMenuItem
                  onClick={() =>
                    onDuplicate({
                      id: row.original.id,
                      title: row.original.title,
                      description: row.original.description,
                      descriptionJson: row.original.descriptionJson,
                    })
                  }
                  className="flex items-center gap-2"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Duplicate Problem
                </DropdownMenuItem>
              )}
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
                className={`text-destructive focus:text-destructive flex items-center gap-2 ${
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

  const answerDialog = (() => {
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
            epsSymbol={epsSymbol}
          />
        );
      default:
        return null;
    }
  })();

  const descriptionDialog = descDialog.problem ? (
    <Dialog
      open={descDialog.open}
      onOpenChange={(open) => setDescDialog({ open, problem: open ? descDialog.problem : null })}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Problem Description</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {descDialog.problem.title}
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
            description={descDialog.problem.description}
            descriptionJson={(descDialog.problem as { descriptionJson?: unknown }).descriptionJson}
          />
        </div>
      </DialogContent>
    </Dialog>
  ) : null;

  const viewDialog =
    answerDialog || descriptionDialog ? (
      <>
        {answerDialog}
        {descriptionDialog}
      </>
    ) : null;

  return { columns, viewDialog };
};
