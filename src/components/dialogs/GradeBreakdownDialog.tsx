'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable } from '@/components/ui/data-table';
import { ColumnDef } from '@tanstack/react-table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { showToast } from '@/lib/toast';
import { Loader2 } from 'lucide-react';
import { apiPaths } from '@/lib/api-paths';

type Row = {
  // the DataTable needs a stable `id` field (or `_id`) for its row
  // key; we mirror the problemId here so tables render without errors.
  id: string;
  problemId: string;
  title: string;
  maxPoints: number;
  grade: number | null;
};

interface GradeBreakdownDialogProps {
  courseId: string;
  assignmentId: string;
  assignmentTitle: string;
  studentId: string;
  studentName: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  onSaved?: () => void;
}

export function GradeBreakdownDialog({
  courseId,
  assignmentId,
  assignmentTitle,
  studentId,
  studentName,
  open,
  setOpen,
  onSaved,
}: GradeBreakdownDialogProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [originalRows, setOriginalRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  // Assignment problem links (with maxPoints) and the student's current per-problem
  // grades — both cached and fetched only while the dialog is open, so reopening the
  // same breakdown is served warm instead of refetching every time.
  const assignmentQuery = useQuery({
    queryKey: ['course', courseId, 'assignment', assignmentId],
    queryFn: async () => {
      const res = await fetch(apiPaths.assignment(courseId, assignmentId));
      if (!res.ok) throw new Error('Failed to fetch assignment');
      return (await res.json()) as {
        problems?: Array<{ problem: { id: string; title?: string | null }; maxPoints: number }>;
      };
    },
    enabled: open,
    staleTime: 30_000,
  });

  const gradesQuery = useQuery({
    queryKey: ['course', courseId, 'assignment', assignmentId, 'problem-grades', studentId],
    queryFn: async () => {
      const res = await fetch(
        `/api/courses/${courseId}/${assignmentId}/problem-grades/${studentId}`,
      );
      // 204 means nothing graded yet — treat as an empty map.
      if (res.status === 204) return {} as Record<string, { grade: number | null }>;
      if (!res.ok) throw new Error('Failed to fetch problem grades');
      return (await res.json()) as Record<string, { grade: number | null }>;
    },
    enabled: open,
    staleTime: 30_000,
  });

  const loading = assignmentQuery.isFetching || gradesQuery.isFetching;
  const loadFailed = assignmentQuery.isError || gradesQuery.isError;

  // Surface a load failure the same way the imperative fetch did.
  useEffect(() => {
    if (loadFailed) {
      showToast.error('Failed to load grade breakdown');
    }
  }, [loadFailed]);

  // Seed the editable rows from the cached reads whenever the dialog opens (or the
  // underlying data changes). Edits live in local state from here.
  useEffect(() => {
    if (!open) return;
    const assignment = assignmentQuery.data;
    const grades = gradesQuery.data;
    if (!assignment || grades === undefined) return;
    const problemLinks = assignment.problems ?? [];
    const newRows: Row[] = problemLinks.map((link) => ({
      id: link.problem.id,
      problemId: link.problem.id,
      title: link.problem.title ?? 'Untitled',
      maxPoints: link.maxPoints,
      grade: grades[link.problem.id]?.grade ?? null,
    }));
    setRows(newRows);
    setOriginalRows(newRows);
  }, [open, assignmentQuery.data, gradesQuery.data]);

  const handleGradeChange = useCallback((problemId: string, value: string) => {
    const num = value === '' ? null : parseFloat(value);
    setRows((prev) => prev.map((r) => (r.problemId === problemId ? { ...r, grade: num } : r)));
  }, []);

  const totals = useMemo(() => {
    const earned = rows.reduce((sum, r) => sum + (r.grade ?? 0), 0);
    const possible = rows.reduce((sum, r) => sum + r.maxPoints, 0);
    const hasAny = rows.some((r) => typeof r.grade === 'number');
    return { earned, possible, hasAny };
  }, [rows]);

  const isDirty = useMemo(() => {
    if (rows.length !== originalRows.length) return true;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].grade !== originalRows[i].grade) return true;
    }
    return false;
  }, [rows, originalRows]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // One request for the whole breakdown; the server diffs and writes only what
      // changed (replaces the old one-POST-per-problem fan-out).
      const gradesPayload = rows.reduce<Record<string, number | null>>((acc, r) => {
        acc[r.problemId] = r.grade;
        return acc;
      }, {});
      const res = await fetch(
        `/api/courses/${courseId}/${assignmentId}/problem-grades/${studentId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grades: gradesPayload }),
        },
      );
      if (!res.ok) throw new Error('save');
      // Refresh this student's cached grades so reopening reflects the save; the
      // parent (grades matrix) refreshes via onSaved.
      await queryClient.invalidateQueries({
        queryKey: ['course', courseId, 'assignment', assignmentId, 'problem-grades', studentId],
      });
      showToast.success('Grades saved');
      onSaved?.();
      setOpen(false);
    } catch (err) {
      console.error('save error', err);
      showToast.error('Failed to save grades');
    } finally {
      setSaving(false);
    }
  }, [rows, courseId, assignmentId, studentId, onSaved, setOpen, queryClient]);

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        accessorKey: 'Problem',
        header: 'Problem',
        cell: ({ row }) => <div className="truncate">{row.original.title}</div>,
        meta: { priority: 1 },
      },
      {
        accessorKey: 'Max Points',
        header: 'Max',
        cell: ({ row }) => <div>{row.original.maxPoints}</div>,
        meta: { priority: 2 },
      },
      {
        id: 'Grade',
        header: 'Grade',
        cell: ({ row }) => {
          const r = row.original;
          return (
            <Input
              type="number"
              className="w-24"
              min={0}
              max={r.maxPoints}
              value={r.grade === null ? '' : String(r.grade)}
              onChange={(e) => handleGradeChange(r.problemId, e.target.value)}
            />
          );
        },
        meta: { priority: 3 },
      },
    ],
    [handleGradeChange],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* widen the content for better data table fit */}
      {/* expanded max width to accommodate more content without wrapping */}
      <DialogContent className="bg-card sm:max-w-3xl lg:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {studentName} &ndash; {assignmentTitle}
          </DialogTitle>
          <DialogDescription>Edit individual problem scores for this assignment.</DialogDescription>
          {/* current score summary */}
          <div className="mt-1 text-right text-sm font-medium">
            Score:{' '}
            {totals.hasAny ? `${totals.earned} / ${totals.possible}` : `- / ${totals.possible}`}
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto">
          <DataTable columns={columns} data={rows} loading={loading} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isDirty || saving || rows.length === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
