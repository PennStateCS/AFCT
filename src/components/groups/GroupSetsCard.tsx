'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Layers, Plus } from 'lucide-react';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { CreateGroupSetDialog } from './CreateGroupSetDialog';
import { GroupSetView } from './GroupSetView';
import type { GroupSetSummary } from './group-set-types';

/** Suggest a non-colliding "X Copy" name for the current set (client-side). */
function suggestCopyName(baseName: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  const base = `${baseName.trim()} Copy`;
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

const EMPTY: GroupSetSummary[] = [];

/**
 * The redesigned Groups tab. Shows the course's group sets in a selector, then
 * the selected set's groups and students. Independent of the legacy flat groups.
 */
export function GroupSetsCard({
  courseId,
  courseIsArchived = false,
}: {
  courseId: string;
  courseIsArchived?: boolean;
}) {
  const queryClient = useQueryClient();
  const selectorId = useId();
  const listKey = queryKeys.course.groupSets(courseId);

  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: () => fetchJson<GroupSetSummary[]>(apiPaths.courseGroupSets(courseId)),
    staleTime: 15_000,
  });
  const sets = listQuery.data ?? EMPTY;

  const [selectedId, setSelectedId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Keep the selection valid: fall back to the first set when the current one is
  // gone (e.g. after a delete) or nothing is selected yet.
  useEffect(() => {
    if (sets.length === 0) {
      if (selectedId !== '') setSelectedId('');
      return;
    }
    if (!sets.some((s) => s.id === selectedId)) {
      setSelectedId(sets[0]!.id);
    }
  }, [sets, selectedId]);

  const refreshList = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: listKey }),
    [queryClient, listKey],
  );

  const selectedSet = sets.find((s) => s.id === selectedId) ?? null;
  const suggestedDuplicateName = useMemo(
    () =>
      selectedSet
        ? suggestCopyName(
            selectedSet.name,
            sets.map((s) => s.name),
          )
        : '',
    [selectedSet, sets],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <Layers className="h-5 w-5" />
          Groups
        </h2>
        <Button onClick={() => setCreateOpen(true)} disabled={courseIsArchived}>
          <Plus className="h-4 w-4" /> Create group set
        </Button>
      </div>

      {listQuery.isPending ? (
        <LoadingSpinner label="Loading group sets" fullScreen={false} className="min-h-40" />
      ) : sets.length === 0 ? (
        <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center">
          <Layers className="mx-auto mb-2 h-8 w-8 text-gray-400" aria-hidden="true" />
          <p className="font-medium">No group sets yet</p>
          <p className="text-sm">
            A group set is one arrangement of students, such as Project 1 or Lab Partners.
          </p>
          <Button className="mt-4" onClick={() => setCreateOpen(true)} disabled={courseIsArchived}>
            <Plus className="h-4 w-4" /> Create your first group set
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={selectorId} className="text-sm">
              Group set
            </Label>
            <select
              id={selectorId}
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="border-input bg-background focus-visible:ring-ring/40 h-9 rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
            >
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.groupCount} group{s.groupCount === 1 ? '' : 's'}, {s.assignedCount}{' '}
                  assigned)
                </option>
              ))}
            </select>
          </div>

          {selectedId && (
            <GroupSetView
              key={selectedId}
              courseId={courseId}
              setId={selectedId}
              suggestedDuplicateName={suggestedDuplicateName}
              onListChanged={refreshList}
              onSelectSet={setSelectedId}
              courseIsArchived={courseIsArchived}
            />
          )}
        </>
      )}

      <CreateGroupSetDialog
        open={createOpen}
        setOpen={setCreateOpen}
        courseId={courseId}
        onCreated={(id) => {
          refreshList();
          setSelectedId(id);
        }}
      />
    </div>
  );
}

export default GroupSetsCard;
