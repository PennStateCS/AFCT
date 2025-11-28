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
}

export function ProblemsCard({ 
  courseIsArchived,
  problems, 
  problemColumns, 
  onCreateProblem 
}: ProblemsCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-2xl flex items-center gap-2"><FileText className="h-5 w-5" />Problems</CardTitle>
        <Button variant="default" onClick={onCreateProblem} disabled={courseIsArchived}>
          <Plus /> Create Problem
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {problems.length ? (
          <DataTable columns={problemColumns} data={problems} />
        ) : (
          <p className="text-muted-foreground italic">No problems added.</p>
        )}
      </CardContent>
    </Card>
  );
}
