'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { DataTable } from '@/components/ui/data-table';
import type { ColumnDef } from '@tanstack/react-table';
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
import { ClipboardList, Loader2 } from 'lucide-react';
import { apiPaths } from '@/lib/api-paths';
import { BatchProblemGradesSchema, gradeCellSchema } from '@/schemas/grade';

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

  // Assignment problem links (with maxPoints) and the student's current per-problem
  // grades: both cached and fetched only while the dialog is open, so reopening the
  // same breakdown is served warm instead of refetching every time.
  const assignmentQuery = useQuery({
    queryKey: queryKeys.assignment.gradeBreakdown(courseId, assignmentId),
    queryFn: () =>
      fetchJson<{
        problems?: Array<{ problem: { id: string; title?: string | null }; maxPoints: number }>;
      }>(apiPaths.assignment(courseId, assignmentId)),
    enabled: open,
    staleTime: 30_000,
  });

  const gradesQuery = useQuery({
    queryKey: queryKeys.assignment.problemGrades(courseId, assignmentId, studentId),
    queryFn: async () => {
      const res = await fetch(apiPaths.assignmentProblemGrades(courseId, assignmentId, studentId));
      // 204 means nothing graded yet; treat as an empty map.
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
      if (rows[i]?.grade !== originalRows[i]?.grade) return true;
    }
    return false;
  }, [rows, originalRows]);

  // One request for the whole breakdown; the server diffs and writes only what
  // changed. Non-optimistic: the save is confirmed before we invalidate/close.
  const { mutate: saveGrades, isPending: saving } = useMutation({
    mutationFn: (gradesPayload: Record<string, number | null>) =>
      fetchJson(apiPaths.assignmentProblemGrades(courseId, assignmentId, studentId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grades: gradesPayload }),
      }),
    onSuccess: async () => {
      // Refresh this student's cached grades so reopening reflects the save; the
      // parent (grades matrix) refreshes via onSaved.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.assignment.problemGrades(courseId, assignmentId, studentId),
      });
      showToast.success('Grades saved');
      onSaved?.();
      setOpen(false);
    },
    onError: (err) => {
      console.error('save error', err);
      showToast.error('Failed to save grades');
    },
  });

  const handleSave = useCallback(() => {
    // Validate each edited grade against its own problem's max before submitting;
    // catches out-of-range and unparseable (NaN) entries that would otherwise be
    // serialized to null. The route re-checks the same bounds server-side.
    for (const r of rows) {
      const result = gradeCellSchema(r.maxPoints).safeParse(r.grade);
      if (!result.success) {
        showToast.error(`${r.title}: ${result.error.issues[0]?.message ?? 'Invalid grade.'}`);
        return;
      }
    }

    const gradesPayload = rows.reduce<Record<string, number | null>>((acc, r) => {
      acc[r.problemId] = r.grade;
      return acc;
    }, {});

    const parsed = BatchProblemGradesSchema.safeParse({ grades: gradesPayload });
    if (!parsed.success) {
      showToast.error('Please review the grades and try again.');
      return;
    }

    saveGrades(parsed.data.grades);
  }, [rows, saveGrades]);

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
              // The "Grade" column header does not say WHICH problem this box belongs
              // to, and a screen reader tabbing form controls never hears the row. Name
              // each input after its problem, and state the ceiling while we are here.
              aria-label={`Grade for ${r.title}, maximum ${r.maxPoints} points`}
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
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            showToolbar={false}
            emptyTitle="No problems to grade"
            emptyDescription="This assignment has no problems, so there is nothing to break down."
            emptyIcon={ClipboardList}
            loadingMessage="Loading grade breakdown, please wait..."
          />
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
