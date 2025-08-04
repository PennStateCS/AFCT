import { ColumnDef } from '@tanstack/react-table';
import { Problem } from '@prisma/client';
import { ArrowUpDown, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

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
    cell: ({ row }) => {
      const problem = row.original;
      return (
        <div className="flex gap-2">
          {/* Edit Button */}
          <Link href={`/dashboard/problems/${problem.id}/edit`}>
            <Button variant="ghost" size="icon" aria-label="Edit Problem">
              <Pencil className="h-4 w-4" />
            </Button>
          </Link>
          {/* Delete Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDeleteClick(problem.id)}
            className="text-red-600"
            aria-label="Delete Problem"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      );
    },
  },
];
