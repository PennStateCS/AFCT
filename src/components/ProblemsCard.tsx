'use client';

import { Problem } from '@prisma/client';
import { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Plus, FileText } from 'lucide-react';

interface ProblemsCardProps {
  courseId: string;
  courseIsArchived: boolean;
  problems: Problem[];
  problemColumns: ColumnDef<Problem>[];
  onCreateProblem: () => void;
  isLoading?: boolean;
}

export function ProblemsCard({
  courseIsArchived,
  problems,
  problemColumns,
  onCreateProblem,
  isLoading = false,
}: ProblemsCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-2xl">
          <FileText className="h-5 w-5" />
          Problems
        </CardTitle>
        <Button variant="default" onClick={onCreateProblem} hidden={courseIsArchived}>
          <Plus /> Create Problem
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {!isLoading && !problems.length ? (
          <p className="text-muted-foreground italic">No problems added.</p>
        ) : (
          <DataTable
            columns={problemColumns}
            data={problems}
            loading={isLoading}
            tableLabel="Problems table"
          />
        )}
      </CardContent>
    </Card>
  );
}
