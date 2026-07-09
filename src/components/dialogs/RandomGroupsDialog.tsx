'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { Plus, Minus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';

type Enrollable = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
};

export default function RandomGroupsDialog({
  open,
  setOpen,
  courseId,
  students,
  onCreated,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  courseId: string;
  students: Enrollable[];
  onCreated?: () => void;
}) {
  const [numGroups, setNumGroups] = useState<number>(2);
  const [prefix, setPrefix] = useState<string>('Group');
  const [loading, setLoading] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('');

  useEffect(() => {
    // Ensure numGroups doesn't exceed available students (students minus excluded)
    const available = Math.max(0, students.length - excluded.size);
    if (available === 0) {
      setNumGroups(1);
      return;
    }
    setNumGroups((prev) => (prev > available ? available : prev));
  }, [students.length, excluded.size]);

  const available = Math.max(0, students.length - excluded.size);
  const validNum =
    available > 0 && numGroups >= 1 && Number.isInteger(numGroups) && numGroups <= available;

  const sizes = useMemo(() => {
    const n = Math.max(0, students.length - excluded.size);
    const k = Math.max(1, Math.floor(numGroups));
    const base = Math.floor(n / k);
    const rem = n % k;
    const out = new Array(k).fill(base);
    for (let i = 0; i < rem; i++) out[i]++;
    return out;
  }, [students.length, numGroups, excluded.size]);

  // Compute distribution: how many groups will have a given size
  const distribution = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of sizes) {
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    // sort by size descending for display
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [sizes]);

  function shuffle<T>(arr: T[]) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function handleCreate() {
    if (!validNum)
      return showToast.error('Enter a valid number of groups (1 - number of students).');
    if (!courseId) return showToast.error('Missing course id');
    if (available === 0) return showToast.error('No students available to assign.');

    setLoading(true);
    try {
      const availableStudents = students.filter((s) => !excluded.has(s.id));
      if (availableStudents.length === 0) throw new Error('No students available to assign.');
      const shuffled = shuffle(availableStudents.map((s) => s.id));
      let idx = 0;
      const createdGroups: unknown[] = [];

      for (let g = 0; g < sizes.length; g++) {
        const groupName = `${prefix} ${g + 1}`;
        // create group
        const createRes = await fetch(apiPaths.courseGroups(courseId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: groupName }),
        });

        if (!createRes.ok) {
          const body = await createRes.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to create group');
        }
        const created = await createRes.json();
        createdGroups.push(created);

        // add members
        const count = sizes[g] ?? 0;
        for (let m = 0; m < count; m++) {
          const uid = shuffled[idx++];
          // user may be undefined if there are fewer students than expected
          if (!uid) continue;
          const addRes = await fetch(apiPaths.courseGroupMembers(courseId, created.id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: uid }),
          });
          if (!addRes.ok) {
            const body = await addRes.json().catch(() => ({}));
            throw new Error(body.error || 'Failed to add member to group');
          }
        }
      }

      showToast.success(`${createdGroups.length} groups created`);
      onCreated?.();
      setOpen(false);
    } catch (err) {
      console.error('Random group creation error:', err);
      showToast.error(err instanceof Error ? err.message : 'Failed to create random groups');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setNumGroups(2);
          setPrefix('Group');
        }
      }}
    >
      <DialogContent className="bg-card max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Random Groups</DialogTitle>
          <DialogDescription>
            Divide {Math.max(0, students.length - excluded.size)} of {students.length} students into
            random groups ({excluded.size} excluded).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <InputGroup
              label="Group Name Prefix"
              name="rg-prefix"
              value={prefix}
              setValue={setPrefix}
            />
          </div>

          <div>
            <InputGroup
              label="Exclude Students"
              name="exclude-search"
              placeholder="Search to exclude"
              value={filter}
              setValue={setFilter}
            />
            <div className="mt-2 h-44 overflow-auto rounded-md border">
              {students.length === 0 ? (
                <div className="text-muted-foreground p-3 text-center text-sm">No students.</div>
              ) : (
                <ul>
                  {students
                    .filter((s) =>
                      ((s.firstName || '') + ' ' + (s.lastName || '') + ' ' + (s.email || ''))
                        .toLowerCase()
                        .includes(filter.trim().toLowerCase()),
                    )
                    .slice(0, 500)
                    .map((s) => (
                      <li key={s.id} className="px-3 py-2">
                        <label className="flex cursor-pointer items-center gap-2">
                          <Checkbox
                            checked={excluded.has(s.id)}
                            onCheckedChange={() => {
                              setExcluded((prev) => {
                                const copy = new Set(prev);
                                if (copy.has(s.id)) copy.delete(s.id);
                                else copy.add(s.id);
                                return copy;
                              });
                            }}
                          />
                          <div className="flex-1 text-sm">
                            <div>
                              {s.firstName} {s.lastName}
                            </div>
                            <div className="text-muted-foreground text-xs">{s.email}</div>
                          </div>
                          <div className="text-muted-foreground text-xs">
                            {excluded.has(s.id) ? 'Excluded' : ''}
                          </div>
                        </label>
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExcluded(new Set(students.map((s) => s.id)))}
              >
                Exclude All
              </Button>
              <Button variant="outline" size="sm" onClick={() => setExcluded(new Set())}>
                Clear Exclusions
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor="rg-count">Number of Groups</Label>
            <div className="mt-2 flex items-center gap-3">
              <Button
                variant="outline"
                className="h-9 w-9 rounded-full p-0"
                onClick={() => setNumGroups((n) => Math.max(1, Math.floor(n) - 1))}
                disabled={numGroups <= 1 || students.length === 0}
                aria-label="Decrease groups"
                title="Decrease groups"
              >
                <Minus className="h-4 w-4" />
              </Button>

              <div className="flex-1">
                <div className="flex items-baseline justify-between">
                  <div className="min-w-[56px] text-center text-2xl font-semibold">{numGroups}</div>
                  <div className="text-muted-foreground text-sm">of {available} students</div>
                </div>

                <input
                  id="rg-count"
                  type="range"
                  min={1}
                  max={Math.max(1, available)}
                  value={numGroups}
                  onChange={(e) => setNumGroups(Number(e.target.value))}
                  className="mt-3 w-full"
                />
              </div>

              <Button
                variant="outline"
                className="h-9 w-9 rounded-full p-0"
                onClick={() =>
                  setNumGroups((n) => Math.min(Math.max(1, students.length), Math.floor(n) + 1))
                }
                disabled={numGroups >= Math.max(1, students.length) || students.length === 0}
                aria-label="Increase groups"
                title="Increase groups"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="text-muted-foreground mt-2 text-xs">Distribution summary:</div>
          </div>

          <div className="rounded-md border p-2 text-sm">
            <div className="font-medium">Distribution</div>
            {distribution.length === 0 ? (
              <div className="text-muted-foreground">No groups</div>
            ) : (
              <ul className="list-inside list-disc">
                {distribution.map(([size, count]) => (
                  <li key={size}>
                    {count} {count === 1 ? 'group' : 'groups'} will have {size}{' '}
                    {size === 1 ? 'student' : 'students'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" type="button" disabled={loading}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={loading || !validNum || students.length === 0}
          >
            {loading ? 'Creating…' : 'Create Random Groups'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
