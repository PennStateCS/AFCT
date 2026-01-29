'use client';

import { Assignment } from '@prisma/client';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Plus, NotebookText } from 'lucide-react';

type AssignmentWithProblemCount = Assignment & {
  problemCount: number;
};

interface AssignmentsCardProps {
  courseId: string;
  courseIsArchived: boolean;
  assignments: AssignmentWithProblemCount[];
  assignmentColumns: ColumnDef<AssignmentWithProblemCount>[];
  onCreateAssignment: () => void;
}

export function AssignmentsCard({ 
  courseIsArchived,
  assignments, 
  assignmentColumns, 
  onCreateAssignment,
}: AssignmentsCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-2xl flex items-center gap-2"><NotebookText className="h-5 w-5" />Assignments</CardTitle>
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
        {assignments.length ? (
          <DataTable columns={assignmentColumns} data={assignments} />
        ) : (
          <p className="text-muted-foreground italic">No assignments found.</p>
        )}
      </CardContent>
    </Card>
  );
}
