'use client';

import { Assignment } from '@prisma/client';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Plus } from 'lucide-react';

type AssignmentWithProblemCount = Assignment & {
  problemCount: number;
};

interface AssignmentsCardProps {
  assignments: AssignmentWithProblemCount[];
  assignmentColumns: ColumnDef<AssignmentWithProblemCount>[];
  onCreateAssignment: () => void;
}

export function AssignmentsCard({ 
  assignments, 
  assignmentColumns, 
  onCreateAssignment 
}: AssignmentsCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-2xl">Assignments</CardTitle>
        <Button
          style={{
            backgroundColor: 'var(--color-primary)',
            color: 'var(--color-primary-foreground)',
          }}
          onClick={onCreateAssignment}
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
