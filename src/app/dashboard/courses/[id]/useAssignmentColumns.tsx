'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Assignment } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, ChevronDown, Eye, BookOpen } from 'lucide-react';
import { Badge } from '@/components/ui/RoleBadge';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import Link from 'next/link';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

export function useAssignmentColumns(
  handleAssignmentDeleteClick: (id: string) => void,
  handleAssignmentEditClick: (assignment: Assignment) => void,
): ColumnDef<Assignment>[] {
  const router = useRouter();
  const headerClass = 'whitespace-normal break-words text-xs sm:text-base px-1 py-1';

  return [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <div>
          <Link
            href={`/dashboard/courses/${row.original.courseId}/${row.original.id}`}
            className="text-primary font-medium hover:underline"
          >
            {row.original.title}
          </Link>
        </div>
      ),
    },
    {
      accessorKey: 'dueDate',
      header: 'Due Date',
      cell: ({ row }) => <div>{format(new Date(row.original.dueDate), "P 'at' p")}</div>,
    },
    {
      accessorKey: 'createdAt',
      header: 'Created At',
      cell: ({ row }) => <div>{format(new Date(row.original.createdAt), "P 'at' p")}</div>,
    },
    {
      accessorKey: 'maxPoints',
      header: ({ column }) => 'Points',
      cell: ({ row }) => <div>{row.original.maxPoints}</div>,
    },
    {
      id: 'problemCount',
      header: 'Problems',
      accessorKey: 'problemCount', // match the field returned by API
      cell: ({ row }) => {
        const count = row.original.problemCount ?? 0;
        return <div>{count}</div>;
      },
      enableSorting: true,
    },
    {
      accessorKey: 'isPublished',
      header: 'Published',
      cell: ({ row }) =>
        row.original.isPublished ? (
          <span className="font-semibold text-green-600">Yes</span>
        ) : (
          <span className="font-semibold text-yellow-600">No</span>
        ),
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
                <BookOpen className="h-4 w-4" />
                {row.original.title}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <Link href={`/dashboard/courses/${row.original.courseId}/${row.original.id}`}>
                <DropdownMenuItem className="hover:bg-secondary focus:bg-secondary focus:text-secondary-foreground flex items-center gap-2">
                  <BookOpen className="mr-2 h-4 w-4" />
                  View Assignment
                </DropdownMenuItem>
              </Link>
              <DropdownMenuItem
                onClick={() => handleAssignmentEditClick(row.original)}
                className="hover:bg-secondary focus:bg-secondary focus:text-secondary-foreground flex items-center gap-2"
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit Assignment
              </DropdownMenuItem>
              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => handleAssignmentDeleteClick(row.original.id)}
                className="hover:bg-secondary focus:bg-secondary focus:text-secondary-foreground flex items-center gap-2 text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Assignment
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ),
    },
  ];
}
