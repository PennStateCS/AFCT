'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-2xl">
          <BookOpen className="h-6 w-6" />
          Assignments
        </CardTitle>
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
      </CardHeader>
      <CardContent className="overflow-x-auto">
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
      </CardContent>
    </Card>
  );
}
