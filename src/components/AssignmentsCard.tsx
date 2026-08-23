'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Plus, BookOpen, Download } from 'lucide-react';
import type { AssignmentWithProblemCount } from '@/types/course';

interface AssignmentsCardProps {
  courseId: string;
  courseIsArchived: boolean;
  assignments: AssignmentWithProblemCount[];
  assignmentColumns: ColumnDef<AssignmentWithProblemCount>[];
  onCreateAssignment: () => void;
  onImportAssignment?: () => void;
  isLoading?: boolean;
}

export function AssignmentsCard({
  courseIsArchived,
  assignments,
  assignmentColumns,
  onCreateAssignment,
  onImportAssignment,
  isLoading = false,
}: AssignmentsCardProps) {
  return (
    // 24px below the heading/action row, against the 16px DataTable keeps between its own
    // toolbar and the table. The two numbers differ on purpose: the heading and its buttons
    // belong to the SECTION, the toolbar belongs to the table, so the larger gap is where
    // the grouping actually changes. Flat 16/16 made the buttons look glued to the filters.
    <div className="space-y-6">
      {/* Stacked below sm, side by side above it: the two buttons plus the heading do not
          fit on a phone, and a single row pushed them off the edge. Same shape as the
          User Accounts header. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <BookOpen className="h-6 w-6" />
          Assignments
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {onImportAssignment && (
            <Button variant="outline" onClick={onImportAssignment} hidden={courseIsArchived}>
              <Download /> Import Assignment
            </Button>
          )}
          <Button onClick={onCreateAssignment} hidden={courseIsArchived}>
            <Plus /> Create Assignment
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <DataTable
          columns={assignmentColumns}
          data={assignments}
          loading={isLoading}
          tableLabel="Assignments table"
          defaultSorting={[{ id: 'dueDate', desc: false }]}
          emptyTitle="No assignments yet"
          emptyDescription={
            courseIsArchived
              ? 'This course was archived without any assignments.'
              : 'Create an assignment to give students something to submit.'
          }
          emptyIcon={BookOpen}
          loadingMessage="Loading assignments, please wait..."
        />
      </div>
    </div>
  );
}
