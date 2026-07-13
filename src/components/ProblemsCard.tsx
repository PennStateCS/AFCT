'use client';

import type { Problem } from '@prisma/client';
import type { ColumnDef } from '@tanstack/react-table';
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
    <div className="space-y-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <FileText className="h-5 w-5" />
          Problems
        </h2>
        <Button variant="default" onClick={onCreateProblem} hidden={courseIsArchived}>
          <Plus /> Create Problem
        </Button>
      </div>
      <div className="overflow-x-auto">
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
      </div>
    </div>
  );
}
