'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Plus, BookOpen } from 'lucide-react';
import type { AssignmentWithProblemCount } from '@/types/course';

interface AssignmentsCardProps {
  courseId: string;
  courseIsArchived: boolean;
  assignments: AssignmentWithProblemCount[];
  assignmentColumns: ColumnDef<AssignmentWithProblemCount>[];
  onCreateAssignment: () => void;
  isLoading?: boolean;
}

export function AssignmentsCard({
  courseIsArchived,
  assignments,
  assignmentColumns,
  onCreateAssignment,
  isLoading = false,
}: AssignmentsCardProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <BookOpen className="h-6 w-6" />
          Assignments
        </h2>
        <Button
          style={{
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-secondary-foreground)',
          }}
          onClick={onCreateAssignment}
          hidden={courseIsArchived}
        >
          <Plus /> Create Assignment
        </Button>
      </div>
      <div className="overflow-x-auto">
        {!isLoading && !assignments.length ? (
          <p className="text-muted-foreground italic">No assignments found.</p>
        ) : (
          <DataTable
            columns={assignmentColumns}
            data={assignments}
            loading={isLoading}
            tableLabel="Assignments table"
          />
        )}
      </div>
    </div>
  );
}
