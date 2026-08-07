'use client';

import type { Problem } from '@prisma/client';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Plus, FileText, Download } from 'lucide-react';

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
      {/* Stacked below sm, side by side above it: the two buttons plus the heading do not
          fit on a phone, and a single row pushed them off the edge. Same shape as the
          User Accounts header. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <FileText className="h-5 w-5" />
          Problems
        </h2>
        <div className="flex flex-wrap items-center gap-2">
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
          emptyIcon={FileText}
          loadingMessage="Loading problems, please wait..."
        />
      </div>
    </div>
  );
}
