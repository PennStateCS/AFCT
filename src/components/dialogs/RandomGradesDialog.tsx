'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { showToast } from '@/lib/toast';

type Assignment = { id: string; title: string; maxPoints: number };
type Student = { id: string; firstName?: string | null; lastName?: string | null; email?: string | null };

export default function RandomGradesDialog({
  open,
  setOpen,
  courseId,
  assignments,
  students,
  onApplied,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  courseId: string;
  assignments: Assignment[];
  students: Student[];
  onApplied?: () => void;
}) {
  const ALL_VALUE = '__ALL__';
  const [assignmentId, setAssignmentId] = useState<string | null>(assignments?.[0]?.id ?? null);
  const [lowPoints, setLowPoints] = useState<number>(0);
  const [meanPoints, setMeanPoints] = useState<number>(0);
  const [highPoints, setHighPoints] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const roundQuarter = (v: number) => Math.round(v * 4) / 4;
  const isAll = assignmentId === ALL_VALUE; 

  useEffect(() => {
    if (!assignmentId && assignments.length > 0) setAssignmentId(assignments[0].id);
  }, [assignments, assignmentId]);

  // When assignment changes (or dialog opened) set sensible defaults based on maxPoints
  useEffect(() => {
    const assignment = assignments.find((a) => a.id === assignmentId);
    const max = isAll ? 100 : assignment?.maxPoints ?? 100;
    // Defaults: low = 0, mean = 75% of max, high = max
    const defaultLow = 0;
    const defaultMean = roundQuarter(Math.min(max, Math.max(0, max * 0.75)));
    const defaultHigh = roundQuarter(max);
    setLowPoints(defaultLow);
    setMeanPoints(defaultMean);
    setHighPoints(defaultHigh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId, isAll]);

  useEffect(() => {
    const assignment = assignments.find((a) => a.id === assignmentId);
    const max = isAll ? 100 : assignment?.maxPoints ?? 100;

    // Constrain values within 0..max and ensure low ≤ mean ≤ high
    let l = roundQuarter(Math.max(0, Math.min(max, lowPoints)));
    let m = roundQuarter(Math.max(0, Math.min(max, meanPoints)));
    let h = roundQuarter(Math.max(0, Math.min(max, highPoints)));
    if (l > m) { m = l; m = roundQuarter(m); }
    if (m > h) { h = m; h = roundQuarter(h); }
    if (l !== lowPoints) setLowPoints(l);
    if (m !== meanPoints) setMeanPoints(m);
    if (h !== highPoints) setHighPoints(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowPoints, meanPoints, highPoints, assignmentId, isAll]);

  // Triangular distribution sampler
  function triangular(min: number, mode: number, max: number) {
    const u = Math.random();
    const c = (mode - min) / (max - min || 1);
    if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
    return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  }

  async function handleApply() {
    if (!assignmentId) return showToast.error('Select an assignment');
    if (lowPoints > meanPoints || meanPoints > highPoints) return showToast.error('Ensure low ≤ mean ≤ high');
    // If a single assignment is selected, ensure it exists; for "All assignments" skip this check
    if (!isAll) {
      const assignment = assignments.find((a) => a.id === assignmentId);
      if (!assignment) return showToast.error('Assignment not found');
    }
    if (!courseId) return showToast.error('Missing course id');
    if (students.length === 0) return showToast.error('No students to grade');

    setLoading(true);
    try {
      if (isAll) {
        if (assignments.length === 0) throw new Error('No assignments to apply to');
        let totalUpdated = 0;
        for (const a of assignments) {
          const lp = Math.round((lowPoints / 100) * a.maxPoints * 4) / 4;
          const mp = Math.round((meanPoints / 100) * a.maxPoints * 4) / 4;
          const hp = Math.round((highPoints / 100) * a.maxPoints * 4) / 4;
          const res = await fetch(`/api/courses/${courseId}/assignments/${a.id}/random-grades`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lowPoints: lp, meanPoints: mp, highPoints: hp }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Failed on assignment ${a.title}`);
          }
          const body = await res.json();
          totalUpdated += body.updated ?? 0;
        }
        showToast.success(`Random grades applied to ${assignments.length} assignments (${totalUpdated} grades)`);
        onApplied?.();
        setOpen(false);
      } else {
        const res = await fetch(`/api/courses/${courseId}/assignments/${assignmentId}/random-grades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lowPoints, meanPoints, highPoints }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to apply random grades');
        }

        const body = await res.json();
        showToast.success(`Random grades applied (${body.updated ?? 0} students)`);
        onApplied?.();
        setOpen(false);
      }
    } catch (err) {
      console.error('Apply random grades error:', err);
      showToast.error(err instanceof Error ? err.message : 'Failed to apply random grades');
    } finally {
      setLoading(false);
    }
  }

  // Simple slider that shows low/mean/high and numeric inputs underneath
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { const isAllOpen = assignmentId === ALL_VALUE; if (isAllOpen) { setLowPoints(0); setMeanPoints(roundQuarter(75)); setHighPoints(roundQuarter(100)); } else { const assignment = assignments.find((a) => a.id === assignmentId); const max = assignment?.maxPoints ?? 100; setLowPoints(0); setMeanPoints(roundQuarter(Math.min(max, Math.max(0, max * 0.75)))); setHighPoints(roundQuarter(max)); } } }}>
      <DialogContent className="bg-card max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Random Grades</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Assignment</Label>
            <div className="mt-2">
              <Select onValueChange={(v) => setAssignmentId(v)} value={assignmentId ?? undefined}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select assignment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All assignments</SelectItem>
                  {assignments.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.title} ({a.maxPoints} pts)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Distribution {isAll ? '(% of assignment max)' : '(Points)'}</Label>
            <div className="mt-3 space-y-4">
              {(() => {
                const assignment = assignments.find((a) => a.id === assignmentId);
                const max = isAll ? 100 : assignment?.maxPoints ?? 100;
                return (
                  <>
                    <div>
                      <Label>{isAll ? 'Possible Low (%)' : 'Possible Low (points)'}</Label>
                      <div className="mt-2 flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={max}
                          step={0.25}
                          value={lowPoints}
                          onChange={(e) => setLowPoints(roundQuarter(Number(e.target.value)))}
                          className="flex-1"
                        />
                        <Input className="w-28" type="number" min={0} max={max} step={0.25} value={lowPoints} onChange={(e) => { const v = Number(e.target.value); setLowPoints(Number.isFinite(v) ? roundQuarter(v) : 0); }} />
                      </div>
                    </div>

                    <div>
                      <Label>{isAll ? 'Mean (%)' : 'Mean (points)'}</Label>
                      <div className="mt-2 flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={max}
                          step={0.25}
                          value={meanPoints}
                          onChange={(e) => setMeanPoints(roundQuarter(Number(e.target.value)))}
                          className="flex-1"
                        />
                        <Input className="w-28" type="number" min={0} max={max} step={0.25} value={meanPoints} onChange={(e) => { const v = Number(e.target.value); setMeanPoints(Number.isFinite(v) ? roundQuarter(v) : 0); }} />
                      </div>
                    </div>

                    <div>
                      <Label>{isAll ? 'Possible High (%)' : 'Possible High (points)'}</Label>
                      <div className="mt-2 flex items-center gap-3">
                        <input
                          type="range"
                          min={0}
                          max={max}
                          step={0.25}
                          value={highPoints}
                          onChange={(e) => setHighPoints(roundQuarter(Number(e.target.value)))}
                          className="flex-1"
                        />
                        <Input className="w-28" type="number" min={0} max={max} step={0.25} value={highPoints} onChange={(e) => { const v = Number(e.target.value); setHighPoints(Number.isFinite(v) ? roundQuarter(v) : 0); }} />
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          <div>
            <div className="text-sm text-muted-foreground">Students to grade: {students.length}</div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" type="button" disabled={loading}>Cancel</Button>
          </DialogClose>
          <Button type="button" onClick={handleApply} disabled={loading || !assignmentId}>{loading ? 'Applying…' : 'Apply Random Grades'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
