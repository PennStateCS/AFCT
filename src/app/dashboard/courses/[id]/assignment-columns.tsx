'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Assignment } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Pencil, Trash2, ChevronDown, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

// Extended assignment type with problem count
type AssignmentWithProblemCount = Assignment & {
  problemCount: number;
  hasSubmissionsOrComments?: boolean;
  submissionCount?: number;
  commentCount?: number;
};

// Component for the publish switch with confirmation dialog
function PublishSwitchCell({ 
  assignment, 
  onPublishToggle 
}: { 
  assignment: AssignmentWithProblemCount; 
  onPublishToggle: (assignmentId: string, newValue: boolean) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState(false);

  const handleSwitchChange = (checked: boolean) => {
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
  handleAssignmentDeleteClick: (id: string) => void,
  handleAssignmentEditClick: (assignment: Assignment) => void,
  handlePublishToggle: (assignmentId: string, newValue: boolean) => void,
): ColumnDef<AssignmentWithProblemCount>[] {
  return [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <div>
          <Link
            href={`/dashboard/courses/${row.original.courseId}/${row.original.id}`}
            className="text-blue-600 hover:underline"
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
      header: () => 'Points',
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
      id: 'submissionCount',
      header: 'Submissions',
      accessorKey: 'submissionCount',
      cell: ({ row }) => <div>{row.original.submissionCount ?? 0}</div>,
      enableSorting: true,
    },
    {
      id: 'commentCount',
      header: 'Comments',
      accessorKey: 'commentCount',
      cell: ({ row }) => <div>{row.original.commentCount ?? 0}</div>,
      enableSorting: true,
    },
    {
      accessorKey: 'isPublished',
      header: 'Published',
      cell: ({ row }) => (
        <PublishSwitchCell
          assignment={row.original}
          onPublishToggle={handlePublishToggle}
        />
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
  const disabled = !!(row.original.hasSubmissionsOrComments);
        const title = disabled ? 'Cannot delete: assignment has submissions or comments' : undefined;

        return (
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
                  <DropdownMenuItem className="hover:bg-secondary flex items-center gap-2">
                    <BookOpen className="mr-2 h-4 w-4" />
                    View Assignment
                  </DropdownMenuItem>
                </Link>
                <DropdownMenuItem
                  onClick={() => handleAssignmentEditClick(row.original)}
                  className="hover:bg-secondary flex items-center gap-2"
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit Assignment
                </DropdownMenuItem>
                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => {
                    if (disabled) return;
                    handleAssignmentDeleteClick(row.original.id);
                  }}
                  title={title}
                  className={`flex items-center gap-2 ${disabled ? 'opacity-50 cursor-not-allowed text-gray-500' : '"hover:bg-secondary focus:text-red-600 text-red-600'}`}
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
