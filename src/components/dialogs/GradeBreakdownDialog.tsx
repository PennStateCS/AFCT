'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

type Row = {
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
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [originalRows, setOriginalRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, gRes] = await Promise.all([
        fetch(`/api/courses/${courseId}/${assignmentId}`),
        fetch(
          `/api/courses/${courseId}/${assignmentId}/problem-grades/${studentId}`,
        ),
      ]);
      if (!aRes.ok) throw new Error('assignment');
      if (!gRes.ok && gRes.status !== 204) throw new Error('grades');

      const assignment = await aRes.json();
      const grades = gRes.status === 204 ? {} : await gRes.json();

      const problemLinks: Array<{
        problem: { id: string; title?: string | null };
        maxPoints: number;
      }> = assignment.problems || [];

      const newRows: Row[] = problemLinks.map((link) => ({
        problemId: link.problem.id,
        title: link.problem.title ?? 'Untitled',
        maxPoints: link.maxPoints,
        grade: grades[link.problem.id]?.grade ?? null,
      }));
      setRows(newRows);
      setOriginalRows(newRows);
    } catch (err) {
      console.error('failed to load breakdown', err);
      showToast.error('Failed to load grade breakdown');
    } finally {
      setLoading(false);
    }
  }, [assignmentId, courseId, studentId]);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  const handleGradeChange = useCallback(
    (problemId: string, value: string) => {
      const num = value === '' ? null : parseFloat(value);
      setRows((prev) =>
        prev.map((r) => (r.problemId === problemId ? { ...r, grade: num } : r)),
      );
    },
    [],
  );

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
      await Promise.all(
        rows.map((r) =>
          fetch(
            `/api/courses/${courseId}/${assignmentId}/problems/${r.problemId}/grade/${studentId}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ grade: r.grade }),
            },
          ).then((res) => {
            if (!res.ok) throw new Error('save');
          }),
        ),
      );
      showToast.success('Grades saved');
      onSaved?.();
      setOpen(false);
    } catch (err) {
      console.error('save error', err);
      showToast.error('Failed to save grades');
    } finally {
      setSaving(false);
    }
  }, [rows, courseId, assignmentId, studentId, onSaved, setOpen]);

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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {studentName} &ndash; {assignmentTitle}
          </DialogTitle>
          <DialogDescription>
            Edit individual problem scores for this assignment.
          </DialogDescription>
          {/* current score summary */}
          <div className="mt-1 text-sm font-medium text-right">
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
