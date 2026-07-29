'use client';

import type { Problem } from '@prisma/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Plus, Download } from 'lucide-react';
import { ProblemIcon } from '@/lib/icons';

interface ProblemsCardProps {
  courseId: string;
  courseIsArchived: boolean;
  problems: Problem[];
  problemColumns: ColumnDef<Problem>[];
  onCreateProblem: () => void;
  onImportProblem?: () => void;
  isLoading?: boolean;
}

export function ProblemsCard({
  courseIsArchived,
  problems,
  problemColumns,
  onCreateProblem,
  onImportProblem,
  isLoading = false,
}: ProblemsCardProps) {
  return (
    <div className="space-y-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <ProblemIcon className="h-5 w-5" />
          Problems
        </h2>
        <div className="flex items-center gap-2">
          {onImportProblem && (
            <Button variant="outline" onClick={onImportProblem} hidden={courseIsArchived}>
              <Download /> Import Problem
            </Button>
          )}
          <Button variant="default" onClick={onCreateProblem} hidden={courseIsArchived}>
            <Plus /> Create Problem
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <DataTable
          columns={problemColumns}
          data={problems}
          loading={isLoading}
          tableLabel="Problems table"
          // The creation date is rarely needed; hide it by default. It stays available
          // through the Columns menu.
          defaultColumnVisibility={{ createdAt: false }}
          emptyTitle="No problems yet"
          emptyDescription={
            courseIsArchived
              ? 'This course was archived without any problems.'
              : 'Create a problem to add to an assignment.'
          }
          emptyIcon={ProblemIcon}
          loadingMessage="Loading problems, please wait..."
        />
      </div>
    </div>
  );
}
