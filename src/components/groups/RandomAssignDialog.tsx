'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { apiPaths } from '@/lib/api-paths';
import { showToast } from '@/lib/toast';
import type { GroupSetDetail, RandomAssignPreview } from './group-set-types';
import { studentName } from './group-set-types';

/**
 * Random assignment: pick which active students to include, optionally reassign
 * students who already hold a group, preview a balanced split, then apply it
 * atomically. Applying sends the preview's operations with its basis token, so a
 * change by another staff member since the preview is rejected with a conflict.
 */
export function RandomAssignDialog({
  open,
  setOpen,
  courseId,
  detail,
  onApplied,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  courseId: string;
  detail: GroupSetDetail;
  onApplied: (updated: GroupSetDetail) => void;
}) {
  // Map of assigned active students -> their group name, for labels + defaults.
  const assignedGroupByUser = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of detail.groups) {
      for (const m of g.members) if (!m.inactive) map.set(m.id, g.name);
    }
    return map;
  }, [detail.groups]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reassignSelected, setReassignSelected] = useState(false);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<RandomAssignPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Default selection: active students who are currently unassigned.
  useEffect(() => {
    if (open) {
      const unassigned = detail.eligibleStudents
        .filter((s) => !assignedGroupByUser.has(s.id))
        .map((s) => s.id);
      setSelected(new Set(unassigned));
      setReassignSelected(false);
      setSearch('');
      setPreview(null);
      setError(null);
      setBusy(false);
    }
  }, [open, detail.eligibleStudents, assignedGroupByUser]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return detail.eligibleStudents;
    return detail.eligibleStudents.filter((s) =>
      `${s.firstName ?? ''} ${s.lastName ?? ''} ${s.email}`.toLowerCase().includes(q),
    );
  }, [detail.eligibleStudents, search]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllActive = () =>
    setSelected(new Set(detail.eligibleStudents.map((s) => s.id)));
  const selectNone = () => setSelected(new Set());

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiClient.post<RandomAssignPreview>(
        apiPaths.courseGroupSetRandomAssign(courseId, detail.id),
        { studentIds: Array.from(selected), reassignSelected },
      );
      setPreview(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to build a preview');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!preview) return;
    if (preview.operations.length === 0) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await apiClient.post<GroupSetDetail>(
        apiPaths.courseGroupSetMemberships(courseId, detail.id),
        { operations: preview.operations, expectedBasis: preview.basis },
      );
      showToast.success('Students assigned');
      onApplied(updated);
      setOpen(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(
          'This group set changed while the preview was open. Close this and try again with the latest groups.',
        );
        setPreview(null);
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to apply the assignment');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Assign Students Randomly</DialogTitle>
          <DialogDescription>
            Selected students are spread across the {detail.groups.length} existing group
            {detail.groups.length === 1 ? '' : 's'} as evenly as possible. Existing groups are not
            changed unless you choose to reassign.
          </DialogDescription>
        </DialogHeader>

        {/* Persistent live region so the preview result is announced when it is built. */}
        <span className="sr-only" role="status" aria-live="polite">
          {preview
            ? `Preview ready. ${preview.placedCount} student${preview.placedCount === 1 ? '' : 's'} will be placed.`
            : ''}
        </span>

        {!preview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search students"
                aria-label="Search students"
                className="max-w-xs"
              />
              <Button type="button" variant="secondary" onClick={selectAllActive}>
                Select all active students
              </Button>
              <Button type="button" variant="ghost" onClick={selectNone}>
                Clear
              </Button>
              <span className="text-muted-foreground text-sm" aria-live="polite">
                {selected.size} selected
              </span>
            </div>

            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {filtered.length === 0 && (
                <li className="text-muted-foreground p-2 text-sm">No students match your search.</li>
              )}
              {filtered.map((s) => {
                const group = assignedGroupByUser.get(s.id);
                return (
                  <li key={s.id}>
                    <label className="flex items-center gap-2 rounded p-1 text-sm hover:bg-muted/50">
                      <Checkbox
                        checked={selected.has(s.id)}
                        onCheckedChange={() => toggle(s.id)}
                        aria-label={`Include ${studentName(s)}`}
                      />
                      <span className="min-w-0 flex-1 truncate">{studentName(s)}</span>
                      {group && (
                        <span className="text-muted-foreground shrink-0 text-xs">in {group}</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>

            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={reassignSelected}
                onCheckedChange={(v) => setReassignSelected(v === true)}
                aria-label="Reassign selected students who are already in a group"
              />
              <span>
                Reassign selected students who are already in a group
                <span className="text-muted-foreground block text-xs">
                  Off by default, so students already placed keep their group.
                </span>
              </span>
            </label>

            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void runPreview()} disabled={busy}>
                {busy ? 'Building…' : 'Preview'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm" aria-live="polite">
              {preview.placedCount === 0
                ? 'No changes: the selected students are already placed.'
                : `${preview.placedCount} student${preview.placedCount === 1 ? '' : 's'} will be placed.`}
              {preview.skippedInactive.length > 0 &&
                ` ${preview.skippedInactive.length} inactive student(s) were skipped.`}
            </p>
            <div className="grid max-h-72 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
              {preview.groups.map((g) => (
                <div key={g.id} className="rounded-md border p-3">
                  <p className="mb-1 text-sm font-medium">
                    {g.name}{' '}
                    <span className="text-muted-foreground">({g.members.length})</span>
                  </p>
                  <ul className="text-muted-foreground space-y-0.5 text-xs">
                    {g.members.map((m) => (
                      <li key={m.id} className="truncate">
                        {studentName(m)}
                        {m.inactive && ' (inactive)'}
                      </li>
                    ))}
                    {g.members.length === 0 && <li className="italic">No students</li>}
                  </ul>
                </div>
              ))}
            </div>

            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPreview(null)}>
                Back
              </Button>
              <Button type="button" onClick={() => void apply()} disabled={busy}>
                {busy ? 'Applying…' : 'Apply assignment'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
