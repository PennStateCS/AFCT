import { ColumnDef } from '@tanstack/react-table';
import { Problem } from '@prisma/client';
import { ArrowUpDown, Pencil, Trash2, ChevronDown, Notebook } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

const handleDelete = (problemId: string) => {
  console.log('Deleting problem with ID:', problemId);
};

const typeLabels: Record<string, string> = {
  FA: 'Finite Automaton',
  PDA: 'Push-Down Automaton',
  CFG: 'Context-Free Grammar',
  RE: 'Regular Expression',
};

export const problemColumns = (handleDeleteClick: (id: string) => void): ColumnDef<Problem>[] => [
  {
    accessorKey: 'title',
    header: 'Title',
  },
  {
    accessorKey: 'type',
    header: 'Type',
    cell: ({ row }) => typeLabels[row.original.type] || row.original.type,
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
          href={`/uploads/solutions/${fileName}`}
          download={file} // This attribute prompts download and sets the suggested filename
          className="text-sm break-all text-blue-600 underline"
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
    cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              <ChevronDown />
              Manage
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="flex items-center gap-2">
              <Notebook className="h-4 w-4" />
              {row.original.title}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleAssignmentEditClick(row.original)}
              className="hover:bg-secondary focus:bg-secondary focus:text-secondary-foreground flex items-center gap-2"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit Problem
            </DropdownMenuItem>
            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => handleAssignmentDeleteClick(row.original.id)}
              className="hover:bg-secondary focus:bg-secondary focus:text-secondary-foreground flex items-center gap-2 text-red-600"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Problem
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    ),
  },
];
