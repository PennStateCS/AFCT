'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { apiClient, ApiError } from '@/lib/api/fetch-client';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { showToast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Copy, MoreVertical, Pencil, Plus, Shuffle, Trash2, Users } from 'lucide-react';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { NameDialog } from './NameDialog';
import { DuplicateGroupSetDialog } from './DuplicateGroupSetDialog';
import { RandomAssignDialog } from './RandomAssignDialog';
import type { GroupSetDetail, MembershipOperation } from './group-set-types';
import { studentName } from './group-set-types';

/**
 * The selected group set: its header + actions, summary counts, a searchable
 * unassigned-students panel, and a responsive grid of group cards. Assigning,
 * moving, and removing all work through a selection model (checkboxes + an action
 * bar), so nothing depends on drag and drop.
 */
export function GroupSetView({
  courseId,
  setId,
  suggestedDuplicateName,
  onListChanged,
  onSelectSet,
  courseIsArchived,
}: {
  courseId: string;
  setId: string;
  suggestedDuplicateName: string;
  /** Refetch the set list (name/count/membership changed). */
  onListChanged: () => void;
  /** Switch the selected set ('' to let the parent pick the first remaining). */
  onSelectSet: (id: string) => void;
  courseIsArchived: boolean;
}) {
  const queryClient = useQueryClient();
  const detailKey = queryKeys.course.groupSet(courseId, setId);

  const detailQuery = useQuery({
    queryKey: detailKey,
    queryFn: () => fetchJson<GroupSetDetail>(apiPaths.courseGroupSet(courseId, setId)),
    staleTime: 15_000,
  });
  const detail = detailQuery.data;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // Dialog state
  const [renameSetOpen, setRenameSetOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [randomOpen, setRandomOpen] = useState(false);
  const [deleteSetOpen, setDeleteSetOpen] = useState(false);
  const [renameGroup, setRenameGroup] = useState<{ id: string; name: string } | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<{ id: string; name: string } | null>(null);

  const disabled = courseIsArchived || !!detail?.locked;

  const assignedIds = useMemo(() => {
    const s = new Set<string>();
    if (detail) for (const g of detail.groups) for (const m of g.members) s.add(m.id);
    return s;
  }, [detail]);

  const unassigned = useMemo(() => {
    if (!detail) return [];
    const q = search.trim().toLowerCase();
    return detail.eligibleStudents
      .filter((s) => !assignedIds.has(s.id))
      .filter((s) =>
        !q ? true : `${s.firstName ?? ''} ${s.lastName ?? ''} ${s.email}`.toLowerCase().includes(q),
      );
  }, [detail, assignedIds, search]);

  const counts = useMemo(() => {
    if (!detail) return { groups: 0, eligible: 0, assigned: 0, unassigned: 0 };
    const eligibleIds = new Set(detail.eligibleStudents.map((s) => s.id));
    let assigned = 0;
    for (const id of assignedIds) if (eligibleIds.has(id)) assigned++;
    return {
      groups: detail.groups.length,
      eligible: eligibleIds.size,
      assigned,
      unassigned: eligibleIds.size - assigned,
    };
  }, [detail, assignedIds]);

  const clearSelection = () => setSelected(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Apply membership operations atomically, passing the loaded basis so a
  // concurrent edit is caught. Updates the cache with the server's fresh detail.
  const applyOps = useCallback(
    async (operations: MembershipOperation[], successMsg: string) => {
      if (!detail || operations.length === 0) return;
      setBusy(true);
      try {
        const updated = await apiClient.post<GroupSetDetail>(
          apiPaths.courseGroupSetMemberships(courseId, setId),
          { operations, expectedBasis: detail.basis },
        );
        queryClient.setQueryData(detailKey, updated);
        onListChanged();
        clearSelection();
        showToast.success(successMsg);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          showToast.error(
            'This group set changed on another screen. Refreshing to the latest groups.',
          );
          void queryClient.invalidateQueries({ queryKey: detailKey });
          clearSelection();
        } else {
          showToast.error(err instanceof ApiError ? err.message : 'Failed to update groups');
        }
      } finally {
        setBusy(false);
      }
    },
    [detail, courseId, setId, queryClient, detailKey, onListChanged],
  );

  // Only active students may be assigned/moved; inactive selected are excluded.
  const eligibleSelectedIds = useMemo(() => {
    if (!detail) return [];
    const active = new Set(detail.eligibleStudents.map((s) => s.id));
    return Array.from(selected).filter((id) => active.has(id));
  }, [detail, selected]);

  const moveSelectedTo = (groupId: string, groupName: string) => {
    const movable = eligibleSelectedIds;
    if (movable.length === 0) {
      showToast.warning('Select one or more active students first.');
      return;
    }
    const skipped = selected.size - movable.length;
    void applyOps(
      movable.map((userId) => ({ userId, groupId })),
      `Moved ${movable.length} to ${groupName}${skipped > 0 ? ` (${skipped} inactive skipped)` : ''}`,
    );
  };

  const removeSelected = () => {
    if (selected.size === 0) return;
    // Only remove those currently in a group.
    const toRemove = Array.from(selected).filter((id) => assignedIds.has(id));
    if (toRemove.length === 0) {
      showToast.warning('None of the selected students are in a group.');
      return;
    }
    void applyOps(
      toRemove.map((userId) => ({ userId, groupId: null })),
      `Removed ${toRemove.length} from their group`,
    );
  };

  const doRename = async (name: string) => {
    await apiClient.patch<{ id: string; name: string }>(apiPaths.courseGroupSet(courseId, setId), {
      name,
    });
    onListChanged();
    void queryClient.invalidateQueries({ queryKey: detailKey });
    showToast.success('Group set renamed');
  };

  const doCreateGroup = async (name: string) => {
    await apiClient.post(apiPaths.courseGroupSetGroups(courseId, setId), { name });
    void queryClient.invalidateQueries({ queryKey: detailKey });
    onListChanged();
    showToast.success('Group created');
  };

  const doRenameGroup = async (name: string) => {
    if (!renameGroup) return;
    await apiClient.patch(apiPaths.courseGroupSetGroup(courseId, setId, renameGroup.id), { name });
    void queryClient.invalidateQueries({ queryKey: detailKey });
    showToast.success('Group renamed');
  };

  const confirmDeleteGroup = async () => {
    if (!deleteGroup) return;
    try {
      await apiClient.del(apiPaths.courseGroupSetGroup(courseId, setId, deleteGroup.id));
      void queryClient.invalidateQueries({ queryKey: detailKey });
      onListChanged();
      showToast.success('Group deleted');
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to delete group');
    } finally {
      setDeleteGroup(null);
    }
  };

  const confirmDeleteSet = async () => {
    setBusy(true);
    try {
      await apiClient.del(apiPaths.courseGroupSet(courseId, setId));
      showToast.success('Group set deleted');
      onListChanged();
      onSelectSet('');
    } catch (err) {
      showToast.error(err instanceof ApiError ? err.message : 'Failed to delete group set');
    } finally {
      setBusy(false);
      setDeleteSetOpen(false);
    }
  };

  if (detailQuery.isPending) {
    return <LoadingSpinner label="Loading group set" fullScreen={false} className="min-h-40" />;
  }
  if (detailQuery.isError || !detail) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Could not load this group set.{' '}
        <button
          type="button"
          className="underline"
          onClick={() => void queryClient.invalidateQueries({ queryKey: detailKey })}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + set actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xl font-semibold">
          {detail.name}
          {detail.locked && <Badge variant="secondary">Locked</Badge>}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setCreateGroupOpen(true)}
            disabled={disabled}
          >
            <Plus className="h-4 w-4" /> Add group
          </Button>
          <Button
            variant="secondary"
            onClick={() => setRandomOpen(true)}
            disabled={disabled || detail.groups.length === 0}
            title={detail.groups.length === 0 ? 'Add a group first' : undefined}
          >
            <Shuffle className="h-4 w-4" /> Random assign
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" aria-label="Group set actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setRenameSetOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Rename set
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDuplicateOpen(true)}>
                <Copy className="mr-2 h-4 w-4" /> Duplicate set
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={disabled}
                onClick={() => setDeleteSetOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete set
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Summary counts */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Groups', value: counts.groups },
          { label: 'Eligible students', value: counts.eligible },
          { label: 'Assigned', value: counts.assigned },
          { label: 'Unassigned', value: counts.unassigned },
        ].map((c) => (
          <div key={c.label} className="rounded-md border p-3">
            <dt className="text-muted-foreground text-xs">{c.label}</dt>
            <dd className="text-2xl font-semibold">{c.value}</dd>
          </div>
        ))}
      </dl>

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div
          className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border p-2"
          role="region"
          aria-label="Selection actions"
        >
          <span className="text-sm font-medium" aria-live="polite">
            {selected.size} selected
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || busy || detail.groups.length === 0}
              >
                Move to <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Move selected to</DropdownMenuLabel>
              {detail.groups.map((g) => (
                <DropdownMenuItem key={g.id} onClick={() => moveSelectedTo(g.id, g.name)}>
                  {g.name}
                </DropdownMenuItem>
              ))}
              {detail.groups.length === 0 && (
                <DropdownMenuItem disabled>No groups yet</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="secondary"
            onClick={removeSelected}
            disabled={disabled || busy}
          >
            Remove from group
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection}>
            Clear
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Unassigned panel */}
        <section className="lg:col-span-1" aria-label="Unassigned students">
          <div className="rounded-md border">
            <div className="border-b p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" /> Unassigned ({unassigned.length})
              </p>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search students"
                aria-label="Search unassigned students"
                className="mt-2"
              />
            </div>
            <ul className="max-h-96 space-y-1 overflow-y-auto p-2">
              {unassigned.length === 0 && (
                <li className="text-muted-foreground p-2 text-sm">
                  {counts.eligible === 0
                    ? 'No active students are enrolled yet.'
                    : 'Every eligible student is assigned.'}
                </li>
              )}
              {unassigned.map((s) => (
                <li key={s.id}>
                  <label className="hover:bg-muted/50 flex items-center gap-2 rounded p-1 text-sm">
                    <Checkbox
                      checked={selected.has(s.id)}
                      onCheckedChange={() => toggle(s.id)}
                      aria-label={`Select ${studentName(s)}`}
                      disabled={disabled}
                    />
                    <span className="min-w-0 flex-1 truncate">{studentName(s)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Group cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
          {detail.groups.length === 0 && (
            <div className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm sm:col-span-2">
              This set has no groups yet. Use &quot;Add group&quot; to create one.
            </div>
          )}
          {detail.groups.map((g) => (
            <div key={g.id} className="flex flex-col rounded-md border">
              <div className="flex items-center justify-between gap-2 border-b p-3">
                <p className="min-w-0 truncate text-sm font-medium">
                  {g.name} <span className="text-muted-foreground">({g.members.length})</span>
                </p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Actions for ${g.name}`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={disabled}
                      onClick={() => setRenameGroup({ id: g.id, name: g.name })}
                    >
                      <Pencil className="mr-2 h-4 w-4" /> Rename group
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={disabled}
                      onClick={() => setDeleteGroup({ id: g.id, name: g.name })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete group
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <ul className="flex-1 space-y-1 p-2">
                {g.members.length === 0 && (
                  <li className="text-muted-foreground p-2 text-xs italic">No students</li>
                )}
                {g.members.map((m) => (
                  <li key={m.id}>
                    <label className="hover:bg-muted/50 flex items-center gap-2 rounded p-1 text-sm">
                      <Checkbox
                        checked={selected.has(m.id)}
                        onCheckedChange={() => toggle(m.id)}
                        aria-label={`Select ${studentName(m)}`}
                        disabled={disabled}
                      />
                      <span className="min-w-0 flex-1 truncate">{studentName(m)}</span>
                      {m.inactive && (
                        <Badge variant="outline" className="shrink-0 text-amber-700">
                          Inactive
                        </Badge>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Dialogs */}
      <NameDialog
        open={renameSetOpen}
        setOpen={setRenameSetOpen}
        title="Rename group set"
        label="Name"
        initialValue={detail.name}
        submitLabel="Save"
        onSubmit={doRename}
      />
      <NameDialog
        open={createGroupOpen}
        setOpen={setCreateGroupOpen}
        title="Add group"
        label="Group name"
        initialValue=""
        submitLabel="Add group"
        onSubmit={doCreateGroup}
      />
      <NameDialog
        open={!!renameGroup}
        setOpen={(v) => !v && setRenameGroup(null)}
        title="Rename group"
        label="Group name"
        initialValue={renameGroup?.name ?? ''}
        submitLabel="Save"
        onSubmit={doRenameGroup}
      />
      <DuplicateGroupSetDialog
        open={duplicateOpen}
        setOpen={setDuplicateOpen}
        courseId={courseId}
        sourceSetId={setId}
        suggestedName={suggestedDuplicateName}
        onDuplicated={(newId) => {
          onListChanged();
          onSelectSet(newId);
        }}
      />
      <RandomAssignDialog
        open={randomOpen}
        setOpen={setRandomOpen}
        courseId={courseId}
        detail={detail}
        onApplied={(updated) => queryClient.setQueryData(detailKey, updated)}
      />
      <ConfirmDialog
        open={deleteSetOpen}
        title="Delete group set"
        description={`Delete "${detail.name}" and all of its groups? This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() => void confirmDeleteSet()}
        onCancel={() => setDeleteSetOpen(false)}
      />
      <ConfirmDialog
        open={!!deleteGroup}
        title="Delete group"
        description={`Delete group "${deleteGroup?.name ?? ''}"? Its members return to unassigned.`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() => void confirmDeleteGroup()}
        onCancel={() => setDeleteGroup(null)}
      />
    </div>
  );
}
