'use client';

import { Assignment } from '@prisma/client';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Plus, NotebookText } from 'lucide-react';
import type { FullCourse } from '@/types/course';

type AssignmentWithProblemCount = Assignment & {
  problemCount: number;
};

interface AssignmentsCardProps {
  assignments: AssignmentWithProblemCount[];
  assignmentColumns: ColumnDef<AssignmentWithProblemCount>[];
  onCreateAssignment: () => void;
  course?: FullCourse | null;
}

export function AssignmentsCard({ 
  assignments, 
  assignmentColumns, 
  onCreateAssignment,
  course = null
}: AssignmentsCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-2xl flex items-center gap-2"><NotebookText className="h-5 w-5" />Assignments</CardTitle>
        <Button
          style={{
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
          }}
          onClick={onCreateAssignment}
          disabled={course?.isArchived}
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
