'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { ChevronDown, Search as SearchIcon, Check } from 'lucide-react';
import { showToast } from '@/lib/toast';

type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
};

type ProblemConfig = {
  maxPoints: number;
  maxSubmissions: number;
  autograderEnabled: boolean;
};

type ProblemSettingsPayload = ProblemConfig & { problemId: string };

type AddProblemModalProps = {
  open: boolean;
  onClose: () => void;
  courseId?: string;
  assignmentId?: string;
  courseIsArchived: boolean;
  allProblems: Problem[];
  usedProblems: Problem[];
  defaultMaxPoints?: number;
  defaultMaxSubmissions?: number;
  defaultAutograderEnabled?: boolean;
  // optionally pass a groupId when adding problems; returns a Promise so the dialog
  // can await the parent-side API operation (no Promise.resolve wrapper needed)
  onAddProblems: (problemIds: string[], groupId?: string) => void | Promise<void>;
};

const TYPE_COLORS: Record<string, string> = {
  FA: 'bg-blue-500 text-white',
  PDA: 'bg-green-500 text-white',
  CFG: 'bg-purple-500 text-white',
  RE: 'bg-orange-500 text-white',
  default: 'bg-muted text-muted-foreground',
};

export function AssociateProblemsDialog({
  open,
  onClose,
  courseId,
  assignmentId,
  courseIsArchived,
  allProblems,
  usedProblems,
  onAddProblems,
  defaultMaxPoints,
  defaultMaxSubmissions,
  defaultAutograderEnabled,
}: AddProblemModalProps) {
  const originalUsedIds = React.useMemo(
    () => new Set(usedProblems.map((p) => p.id)),
    [usedProblems],
  );
  const [movedProblems, setMovedProblems] = React.useState<Problem[]>([]);
  // Track problems that were unassigned from the selected group during this dialog
  const [removedProblemIds, setRemovedProblemIds] = React.useState<string[]>([]);

  // Local copy of course problems. We refresh this on open and whenever the
  // parent `allProblems` prop changes so deleted problems are removed
  // immediately from the dialog UI and any local "moved" state is cleaned up.
  const [localAllProblems, setLocalAllProblems] = React.useState<Problem[]>(allProblems);
  React.useEffect(() => {
    setLocalAllProblems(allProblems);
    // remove any movedProblems that no longer exist (e.g. deleted elsewhere)
    setMovedProblems((prev) => prev.filter((p) => allProblems.some((a) => a.id === p.id)));
  }, [allProblems]);

  // Groups and group-assignment mapping
  const [assignmentIsGroup, setAssignmentIsGroup] = React.useState(false);
  const [groups, setGroups] = React.useState<{ id: string; name: string }[]>([]);
  const [groupsLoading, setGroupsLoading] = React.useState(false);
  const [selectedGroupId, setSelectedGroupId] = React.useState<'ALL' | string>('ALL');
  const [groupFilter, setGroupFilter] = React.useState('');
  const [groupProblemsMap, setGroupProblemsMap] = React.useState<Record<string, string[]>>({});

  // Initialize dialog only after we know which viewer to show (group-based or not)
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [initializing, setInitializing] = React.useState(false);

  React.useEffect(() => {
    let aborted = false;
    const ac = new AbortController();

    async function init() {
      setInitializing(true);
      setInternalOpen(false);
      setMovedProblems([]);
      setSelectedGroupId('ALL');
      setGroupFilter('');
      setGroups([]);
      setGroupProblemsMap({});

      try {
        if (!courseId) {
          setAssignmentIsGroup(false);
          setGroups([]);
          setGroupProblemsMap({});
          setInternalOpen(true);
          return;
        }

        // Determine assignment group support
        let isGroup = false;
        if (assignmentId) {
          const aRes = await fetch(`/api/courses/${courseId}/${assignmentId}`, { signal: ac.signal });
          if (aRes.ok) {
            const aData = await aRes.json();
            isGroup = !!aData?.isGroup;
          }
        }
        if (aborted) return;
        setAssignmentIsGroup(isGroup);

        if (isGroup) {
          setGroupsLoading(true);
          const [grRes, gpRes] = await Promise.all([
            fetch(`/api/courses/${courseId}/groups`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'list' }),
            }),
            fetch(`/api/courses/${courseId}/${assignmentId}/group-problems`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'list' }),
            }),
          ]);

          if (grRes.ok) {
            const gr = await grRes.json();
            setGroups(Array.isArray(gr) ? gr : gr.groups ?? []);
          } else {
            setGroups([]);
          }

          if (gpRes.ok) {
            const gp = await gpRes.json();
            const map: Record<string, string[]> = {};
            for (const g of gp.groups ?? []) map[g.id] = g.problemIds || [];
            setGroupProblemsMap(map);
          } else {
            setGroupProblemsMap({});
          }
          setGroupsLoading(false);
        }

        // Refresh the authoritative problem list for this course when the dialog
        // opens so deleted problems don't remain selectable in the UI.
        try {
          const pRes = await fetch(`/api/courses/${courseId}/problems`, { signal: ac.signal });
          if (pRes.ok) {
            const pData = await pRes.json();
            const list = Array.isArray(pData) ? pData : [];
            setLocalAllProblems(list);
            // ensure any "moved" entries that were deleted are removed
            setMovedProblems((prev) => prev.filter((p) => list.some((x) => x.id === p.id)));
          } else {
            setLocalAllProblems(allProblems);
          }
        } catch (err: any) {
          if (err?.name !== 'AbortError') console.error('Failed to fetch problems for dialog:', err);
          setLocalAllProblems(allProblems);
        }

        if (!aborted) {
          setInternalOpen(true);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Failed to initialize AssociateProblemsDialog:', err);
        // Fallback: show the simple dialog (non-group)
        setAssignmentIsGroup(false);
        setGroups([]);
        setGroupProblemsMap({});
        if (!aborted) setInternalOpen(true);
      } finally {
        if (!aborted) setInitializing(false);
      }
    }

    if (open) init();

    // If parent closed while we were initializing, close local dialog too
    if (!open) {
      setInternalOpen(false);
      setInitializing(false);
    }

    return () => {
      aborted = true;
      ac.abort();
      setInitializing(false);
    };
  }, [open, courseId, assignmentId]);

  const movedIds = new Set(movedProblems.map((p) => p.id));
  const removedIds = new Set(removedProblemIds);

  // Determine which problems are originally assigned for the selected group (or overall assignment when ALL)
  const assignmentProblemIds = React.useMemo(() => new Set(usedProblems.map((p) => p.id)), [usedProblems]);

  const allMappedIds = React.useMemo(() => {
    const s = new Set<string>();
    Object.values(groupProblemsMap).forEach((arr) => arr.forEach((id) => s.add(id)));
    return s;
  }, [groupProblemsMap]);

  // Problems in the assignment that are not mapped to any group are treated as assigned to ALL groups
  const unassignedInAssignment = React.useMemo(() => {
    const s = new Set<string>();
    for (const id of assignmentProblemIds) if (!allMappedIds.has(id)) s.add(id);
    return s;
  }, [assignmentProblemIds, allMappedIds]);

  const originalAssignedIds = React.useMemo(() => {
    // When viewing All Students, only show problems that are not mapped to any group (assignment-level problems)
    if (selectedGroupId === 'ALL') return new Set(unassignedInAssignment);

    // Specific group: include group-mapped problems and unassigned problems (which apply to all groups)
    const s = new Set<string>(groupProblemsMap[selectedGroupId] ?? []);
    for (const id of unassignedInAssignment) s.add(id);
    return s;
  }, [selectedGroupId, unassignedInAssignment, groupProblemsMap]);

  // Left column: problems assigned to the selected group (or assignment if ALL)
  const leftProblems = React.useMemo(() => {
    const assigned = localAllProblems.filter((p) => originalAssignedIds.has(p.id));
    // Add newly moved problems that aren't already assigned
    const newly = movedProblems.filter((p) => !originalAssignedIds.has(p.id));
    return [...assigned, ...newly];
  }, [localAllProblems, originalAssignedIds, movedProblems]);

  // Right column: all problems not currently assigned to the selected group (and not newly moved)
  const rightProblems = React.useMemo(() => {
    return localAllProblems.filter((p) => !originalAssignedIds.has(p.id) && !movedIds.has(p.id));
  }, [localAllProblems, originalAssignedIds, movedIds]);

  // For non-group assignments: available problems are those not in the assignment (and not newly moved)
  const unusedProblems = React.useMemo(() => {
    return localAllProblems.filter((p) => !assignmentProblemIds.has(p.id) && !movedIds.has(p.id));
  }, [localAllProblems, assignmentProblemIds, movedIds]);

  const combinedUsedProblems = [...usedProblems, ...movedProblems];

  // Reset moved and removed lists when switching selected group
  React.useEffect(() => {
    setMovedProblems([]);
    setRemovedProblemIds([]);
  }, [selectedGroupId]);

  // Keep the dialog in sync with external changes while it's open.
  // This covers cases where problems/group mappings are modified elsewhere
  // (remove-problem, delete problem, admin actions) so the UI won't show
  // stale mappings or deleted problems while user has the dialog open.
  React.useEffect(() => {
    if (!internalOpen) return;
    let aborted = false;
    const ac = new AbortController();

    async function syncExternal() {
      try {
        // Fetch latest course problems
        const pReq = fetch(`/api/courses/${courseId}/problems`, { signal: ac.signal });
        // Fetch group->problem mappings only for assignments that support groups (use POST body instead of signal)
        const gpReq = assignmentId
          ? fetch(`/api/courses/${courseId}/${assignmentId}/group-problems`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'list' }),
            })
          : Promise.resolve(null);

        const [pRes, gpRes] = await Promise.all([pReq, gpReq]);

        if (!aborted) {
          if (pRes && pRes.ok) {
            const pData = await pRes.json();
            const list = Array.isArray(pData) ? pData : [];
            setLocalAllProblems(list);
            // remove any movedProblems/removedProblemIds for items that no longer exist
            setMovedProblems((prev) => prev.filter((m) => list.some((x) => x.id === m.id)));
            setRemovedProblemIds((prev) => prev.filter((id) => list.some((x) => x.id === id)));
          }

          if (gpRes && gpRes.ok) {
            const gp = await gpRes.json();
            const map: Record<string, string[]> = {};
            for (const g of gp.groups ?? []) map[g.id] = g.problemIds || [];
            setGroupProblemsMap(map);
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') console.error('Failed to sync AssociateProblemsDialog state:', err);
      }
    }

    syncExternal();
    return () => {
      aborted = true;
      ac.abort();
    };
  }, [internalOpen, usedProblems, assignmentId, courseId]);

  const handleDialogOpenChange = (isOpen: boolean) => {
    // only propagate close events back to parent
    if (!isOpen) {
      setInternalOpen(false);
      onClose();
    }
  };

  // Remove a just-added problem from the right (put it back to available)
  const removeFromAssignment = (problem: Problem) => {
    // If this problem was just moved in this session, undo that
    if (movedIds.has(problem.id)) {
      setMovedProblems(movedProblems.filter((p) => p.id !== problem.id));
      return;
    }

    // If a specific group is selected and this problem was originally mapped to that group,
    // mark it for removal (unassign from that group) and update the local map for immediate feedback
    if (selectedGroupId !== 'ALL') {
      const groupArr = groupProblemsMap[selectedGroupId] ?? [];
      if (groupArr.includes(problem.id)) {
        setGroupProblemsMap({
          ...groupProblemsMap,
          [selectedGroupId]: groupArr.filter((id) => id !== problem.id),
        });
        setRemovedProblemIds([...removedProblemIds, problem.id]);
        return;
      }
    }

    // Otherwise, do nothing (we don't allow removing assignment-level original problems via this action)
  };

  // If we're initializing, don't show the dialog yet; parent expects open to be controlled.
  // Render nothing while initializing to avoid flashing UI.
  if (initializing) return null;

  const handleAdd = async () => {
    const allProblemIds = combinedUsedProblems.map((p) => p.id);
    const groupIdToSend = selectedGroupId === 'ALL' ? undefined : selectedGroupId;

    try {
      if (allProblemIds.length > 0) {
        await onAddProblems(allProblemIds, groupIdToSend);
      }

      if (!assignmentId || !courseId) {
        setMovedProblems([]);
        setInternalOpen(false);
        onClose();
        return;
      }

      // If there are removals from a specific group, call the DELETE endpoint for group mappings first
      if (groupIdToSend && removedProblemIds.length > 0) {
        try {
          const r = await fetch(`/api/courses/${courseId}/${assignmentId}/group-problems`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ problemIds: removedProblemIds, groupId: groupIdToSend }),
          });
          if (!r.ok) throw new Error('Failed to remove group mappings');

          // Clear removals
          setRemovedProblemIds([]);
          showToast.success('Removed group mappings');
        } catch (remErr) {
          console.error('Failed to remove group mappings:', remErr);
          showToast.error('Failed to remove group mappings');
        }
      }

      // Perform API call directly with the left-column IDs (handle errors locally)
      const leftProblemIds = leftProblems.map((p) => p.id);

      // Special-case: user selected "All Students" (assignment-level). If any of the
      // selected problems were previously mapped to one or more groups, delete those
      // group-specific mappings first so the problem becomes an assignment-level problem.
      if (groupIdToSend === undefined && leftProblemIds.length > 0) {
        // problems that currently have any group mapping
        const problemsWithGroupMapping = leftProblemIds.filter((pid) => allMappedIds.has(pid));
        if (problemsWithGroupMapping.length > 0) {
          try {
            const delRes = await fetch(`/api/courses/${courseId}/${assignmentId}/group-problems`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              // Use groupId = 'ALL' to remove mappings for every group for these problems
              body: JSON.stringify({ problemIds: problemsWithGroupMapping, groupId: 'ALL' }),
            });
            if (!delRes.ok) throw new Error('Failed to remove existing group mappings');

            // Update local map immediately for UI feedback
            setGroupProblemsMap((prev) => {
              const copy: Record<string, string[]> = {};
              for (const [gid, arr] of Object.entries(prev)) {
                copy[gid] = arr.filter((id) => !problemsWithGroupMapping.includes(id));
              }
              return copy;
            });

            // If any of these were queued for removal in removedProblemIds, clear them
            setRemovedProblemIds((prev) => prev.filter((id) => !problemsWithGroupMapping.includes(id)));

            showToast.success('Cleared group-specific mappings for selected problems');
          } catch (err) {
            console.error('Failed to clear existing group mappings for All:', err);
            showToast.error('Failed to clear existing group mappings');
          }
        }
      }

      if (leftProblemIds.length > 0) {
        try {
          const res = await fetch(`/api/courses/${courseId}/${assignmentId}/add-problems`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ problemIds: leftProblemIds, groupId: groupIdToSend }),
          });

          if (!res.ok) {
            console.error('add-problems returned non-OK status', res.status);
            showToast.error('Failed to update problems (server error)');
          } else {
            showToast.success('Group problem mappings updated');
          }
        } catch (fetchErr) {
          console.error('Network error when calling add-problems:', fetchErr);
          showToast.error('Network error — failed to update problems');
        }
      }

      setMovedProblems([]);
      setInternalOpen(false);
      onClose();
    } catch (err) {
      console.error('Failed to add problems:', err);
      setInternalOpen(false);
      onClose();
    }
  };

  const AbbrevBadge = ({ type }: { type?: string }) => (
    <span
      className={`ml-auto flex h-6 w-12 items-center justify-center rounded text-xs font-bold tracking-wide ${TYPE_COLORS[type as keyof typeof TYPE_COLORS] || TYPE_COLORS.default} `}
      style={{ minWidth: 48, maxWidth: 48 }}
    >
      {type ?? '--'}
    </span>
  );

  return (
    <Dialog open={internalOpen} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="bg-card !max-w-5xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add Existing Problems to Assignment</DialogTitle>
          <DialogDescription>
            Select problems to add and choose a group if you want them assigned to a specific group.
          </DialogDescription>
        </DialogHeader>
        {assignmentIsGroup ? (
          <Tabs defaultValue="select">
            <TabsList className="bg-card border-border h-10 rounded-md border p-1 shadow-sm">
              <TabsTrigger className="data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=active]:shadow-sm" value="select">Select Problems</TabsTrigger>
              <TabsTrigger className="data-[state=active]:bg-secondary data-[state=active]:text-white data-[state=active]:shadow-sm" value="breakdown">Group Breakdown</TabsTrigger>
            </TabsList>

            <TabsContent value="select">
              <div className="flex gap-2">
                {/* Left: Assigned to selected group (or assignment) */}
                <Card className="flex w-1/2 flex-col p-2">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-sm truncate">Assigned Problems</div>

                    <div className="ml-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="rounded border px-2 py-0.5 text-sm flex items-center gap-2 w-40 justify-between"
                          >
                            <span className="truncate text-left flex-1 min-w-0">
                              {selectedGroupId === 'ALL'
                                ? 'All Students'
                                : groups.find((g) => g.id === selectedGroupId)?.name || 'Select group'}
                            </span>
                            <ChevronDown className="h-4 w-4" />
                          </button>
                      </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-40 p-2">
                          <div className="relative">
                            <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Input className="pl-10" placeholder="Search groups" value={groupFilter} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGroupFilter(e.target.value)} />
                          </div>

                          <div className="max-h-64 overflow-auto rounded-md">
                            <ul>
                              <li>
                                <button
                                  type="button"
                                  onClick={() => setSelectedGroupId('ALL')}
                                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-primary/10 ${selectedGroupId === 'ALL' ? 'bg-primary/10' : ''}`}
                                >
                                  <div className="truncate">All students</div>
                                  {selectedGroupId === 'ALL' && <Check className="h-4 w-4" />}
                                </button>
                              </li>
                              {groupsLoading ? (
                                <li className="p-3 text-sm text-muted-foreground">Loading…</li>
                              ) : groups.filter((g) => g.name.toLowerCase().includes(groupFilter.toLowerCase())).length === 0 ? (
                                <li className="p-3 text-sm text-muted-foreground">No groups available</li>
                              ) : (
                                groups.filter((g) => g.name.toLowerCase().includes(groupFilter.toLowerCase())).map((g) => (
                                  <li key={g.id}>
                                    <button
                                      type="button"
                                      onClick={() => setSelectedGroupId(g.id)}
                                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-primary/10 ${selectedGroupId === g.id ? 'bg-primary/10' : ''}`}
                                    >
                                      <div className="truncate">{g.name}</div>
                                      {selectedGroupId === g.id && <Check className="h-4 w-4" />}
                                    </button>
                                  </li>
                                ))
                              )}
                            </ul>
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                          <div className="flex max-h-72 min-h-[200px] flex-col gap-1 overflow-y-auto">
                    {leftProblems.length === 0 ? (
                      <div className="text-muted-foreground text-center text-xs italic">None</div>
                    ) : (
                      leftProblems.map((problem) => {
                        const isOriginal = originalAssignedIds.has(problem.id);
                        // Allow removal if the problem was just moved OR if it was originally mapped to this specific group
                        const isOriginallyMappedToGroup = selectedGroupId !== 'ALL' && (groupProblemsMap[selectedGroupId] || []).includes(problem.id);
                        const isRemovable = movedIds.has(problem.id) || isOriginallyMappedToGroup;

                        return (
                          <div
                            key={problem.id}
                            className={`bg-background flex items-center rounded border px-1.5 py-1 transition ${isRemovable ? 'cursor-pointer hover:bg-red-100' : 'opacity-70'}`}
                            style={{ minHeight: '32px' }}
                            onClick={isRemovable ? () => removeFromAssignment(problem) : undefined}
                            tabIndex={isRemovable ? 0 : -1}
                            role={isRemovable ? 'button' : undefined}
                          >
                            <span className="truncate pr-2 text-xs font-medium">{problem.title}</span>
                            <AbbrevBadge type={problem.type} />
                          </div>
                        );
                      })
                    )}
                  </div>
                </Card>

                {/* Right: Problems not assigned to selected group */}
                <Card className="flex w-1/2 flex-col p-2">
                  <div className="font-semibold text-sm truncate">All Problems</div>
                  <div className="flex max-h-72 min-h-[200px] flex-col gap-1 overflow-y-auto">
                    {localAllProblems.length === 0 ? (
                      <div className="text-muted-foreground text-center text-xs italic">None</div>
                    ) : (
                      (() => {
                        const selectedSet = new Set(leftProblems.map((p) => p.id));
                        return localAllProblems.map((problem) => {
                          const isSelected = selectedSet.has(problem.id);
                          return (
                            <div
                              key={problem.id}
                              className={`bg-background flex items-center rounded border px-1.5 py-1 transition ${isSelected ? 'opacity-60 pointer-events-none bg-primary/10' : 'hover:bg-green-100 cursor-pointer'}`}
                              style={{ minHeight: '32px' }}
                              onClick={() => {
                                if (!isSelected) setMovedProblems([...movedProblems, problem]);
                              }}
                              tabIndex={isSelected ? -1 : 0}
                              role={isSelected ? undefined : 'button'}
                            >
                              <span className="truncate pr-2 text-xs font-medium">{problem.title}</span>
                              <AbbrevBadge type={problem.type} />
                            </div>
                          );
                        });
                      })()
                    )}
                  </div>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="breakdown">
              <div className="max-h-80 overflow-auto space-y-4 p-2">
                {groupsLoading ? (
                  <div className="text-sm text-muted-foreground">Loading groups…</div>
                ) : groups.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No groups in this course.</div>
                ) : (
                  groups.map((g) => (
                    <Card key={g.id} className="p-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm truncate">{g.name}</div>
                        <div className="text-xs text-muted-foreground">{((groupProblemsMap[g.id] ?? []).length + unassignedInAssignment.size)} problems</div>
                      </div>
                      <div className="mt-2 flex flex-col gap-1">
                        {(() => {
                          const assignedSet = new Set<string>(groupProblemsMap[g.id] ?? []);
                          // Add unassigned problems (apply to all groups)
                          for (const id of unassignedInAssignment) assignedSet.add(id);
                          const assignedArr = Array.from(assignedSet);
                          if (assignedArr.length === 0) {
                            return <div className="text-muted-foreground text-xs italic">No problems assigned to this group.</div>;
                          }
                          return assignedArr.map((pid) => {
                            const p = localAllProblems.find((x) => x.id === pid);
                            if (!p) return null;
                            return (
                              <div key={pid} className="flex items-center gap-2 rounded border px-2 py-1">
                                <div className="truncate text-sm">{p.title}</div>
                                <AbbrevBadge type={p.type} />
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex gap-2">
            <Card className="flex w-1/2 flex-col p-2">
              <div className="font-semibold">All Problems</div>
              <div className="flex max-h-72 min-h-[200px] flex-col gap-1 overflow-y-auto">
                {localAllProblems.length === 0 ? (
                  <div className="text-muted-foreground text-center text-xs italic">None</div>
                ) : (
                  (() => {
                    const selectedSet = new Set(combinedUsedProblems.map((p) => p.id));
                    return localAllProblems.map((problem) => {
                      const isSelected = selectedSet.has(problem.id);
                      return (
                        <div
                          key={problem.id}
                          className={`bg-background flex items-center rounded border px-1.5 py-1 transition ${isSelected ? 'opacity-60 cursor-not-allowed bg-primary/10' : 'hover:bg-green-100 cursor-pointer'}`}
                          style={{ minHeight: '32px' }}
                          onClick={() => {
                            if (!isSelected) setMovedProblems([...movedProblems, problem]);
                          }}
                          tabIndex={isSelected ? -1 : 0}
                          role={isSelected ? undefined : 'button'}
                        >
                          <span className="truncate pr-2 text-xs font-medium">{problem.title}</span>
                          <AbbrevBadge type={problem.type} />
                        </div>
                      );
                    });
                  })()
                )}
              </div>
            </Card>

            <Card className="flex w-1/2 flex-col p-2">
              <div className="font-semibold">In This Assignment</div>
              <div className="flex max-h-72 min-h-[200px] flex-col gap-1 overflow-y-auto">
                {combinedUsedProblems.length === 0 ? (
                  <div className="text-muted-foreground text-center text-xs italic">None</div>
                ) : (
                  combinedUsedProblems.map((problem) => {
                    const isOriginal = originalUsedIds.has(problem.id);
                    const isRemovable = !isOriginal;
                    return (
                      <div
                        key={problem.id}
                        className={`bg-background flex items-center rounded border px-1.5 py-1 transition ${
                          isRemovable ? 'cursor-pointer hover:bg-red-100' : 'opacity-70'
                        }`}
                        style={{ minHeight: '32px' }}
                        onClick={isRemovable ? () => removeFromAssignment(problem) : undefined}
                        tabIndex={isRemovable ? 0 : -1}
                        role={isRemovable ? 'button' : undefined}
                      >
                        <span className="truncate pr-2 text-xs font-medium">{problem.title}</span>
                        <AbbrevBadge type={problem.type} />
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setInternalOpen(false);
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            disabled={(movedProblems.length === 0 && removedProblemIds.length === 0) || courseIsArchived}
            onClick={handleAdd}
          >
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
