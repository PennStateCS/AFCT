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
import { showToast } from '@/lib/toast';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '@/components/ui/dropdown-menu';
import { ChevronDown, Search as SearchIcon, Check } from 'lucide-react';

type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
};

type AddProblemModalProps = {
  open: boolean;
  onClose: () => void;
  courseId: string;
  assignmentId?: string;
  courseIsArchived: boolean;
  allProblems: Problem[];
  usedProblems: Problem[];
  // optionally pass a groupId when adding problems
  onAddProblems: (problemIds: string[], groupId?: string) => void;
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
}: AddProblemModalProps) {
  const originalUsedIds = React.useMemo(
    () => new Set(usedProblems.map((p) => p.id)),
    [usedProblems],
  );
  const [movedProblems, setMovedProblems] = React.useState<Problem[]>([]);
  // Track problems that were unassigned from the selected group during this dialog
  const [removedProblemIds, setRemovedProblemIds] = React.useState<string[]>([]);
  // Track submitting state
  const [submitting, setSubmitting] = React.useState(false);

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
    async function init() {
      setInitializing(true);
      setInternalOpen(false);
      setMovedProblems([]);
      setSelectedGroupId('ALL');
      setGroupFilter('');
      setGroups([]);
      setGroupProblemsMap({});

      try {
        // Determine assignment group support
        let isGroup = false;
        if (assignmentId) {
          const aRes = await fetch(`/api/courses/${courseId}/${assignmentId}`);
          if (aRes.ok) {
            const aData = await aRes.json();
            isGroup = !!aData?.isGroup;
          }
        }
        setAssignmentIsGroup(isGroup);

        if (isGroup) {
          setGroupsLoading(true);
          const [grRes, gpRes] = await Promise.all([
            fetch(`/api/courses/${courseId}/groups`),
            fetch(`/api/courses/${courseId}/${assignmentId}/group-problems`),
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

        setInternalOpen(true);
      } catch (err: any) {
        console.error('Failed to initialize AssociateProblemsDialog:', err);
        // Fallback: show the simple dialog (non-group)
        setAssignmentIsGroup(false);
        setGroups([]);
        setGroupProblemsMap({});
        setInternalOpen(true);
      } finally {
        setInitializing(false);
      }
    }

    if (open) init();

    // If parent closed while we were initializing, close local dialog too
    if (!open) {
      setInternalOpen(false);
      setInitializing(false);
    }

    return () => {
      // No abort logic needed
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

  // Left column: problems assigned to the selected group (or assignment if ALL).
  // Exclude problems the user has removed during this dialog so they disappear immediately
  const leftProblems = React.useMemo(() => {
    const removedSet = new Set(removedProblemIds);
    // Preserve original assigned problems (unless removed)
    const assignedArr = allProblems.filter((p) => originalAssignedIds.has(p.id) && !removedSet.has(p.id));
    const assignedIds = new Set(assignedArr.map((p) => p.id));
    // Include user-moved problems (that are not duplicates and not removed)
    const newly = movedProblems.filter((p) => !assignedIds.has(p.id) && !removedSet.has(p.id));
    return [...assignedArr, ...newly];
  }, [allProblems, originalAssignedIds, movedProblems, removedProblemIds]);

  const combinedUsedProblems = [...usedProblems, ...movedProblems];

  // Reset moved and removed lists when switching selected group
  React.useEffect(() => {
    setMovedProblems([]);
    setRemovedProblemIds([]);
  }, [selectedGroupId]);

  const handleDialogOpenChange = (isOpen: boolean) => {
    // Prevent closing while submitting
    if (submitting) return;
    // only propagate close events back to parent
    if (!isOpen) {
      setInternalOpen(false);
      onClose();
    }
  };

  // Remove a just-added problem from the right (put it back to available)
  const removeFromAssignment = (problem: Problem) => {
    if (submitting) return;
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
    if (!assignmentId) {
      showToast.error('Missing assignment — cannot modify problems.');
      return;
    }

    setSubmitting(true);

    try {
      // Persist removals (only meaningful for a specific group)
      if (removedProblemIds.length > 0) {
        for (const pid of removedProblemIds) {
          // Remove the mapping for this specific group
          const delRes = await fetch(`/api/courses/${courseId}/${assignmentId}/group-problems/problem`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ problemId: pid, groupId: selectedGroupId }),
          });
          if (!delRes.ok) {
            const txt = await delRes.text().catch(() => delRes.statusText);
            throw new Error(`Failed to remove problem from group: ${txt || delRes.status}`);
          }

          // After removing this group's mapping, check if the problem is still mapped to any group.
          // If no groups remain, remove the problem from the assignment entirely so it doesn't become
          // an assignment-level (visible-to-all-groups) problem.
          const gpRes = await fetch(`/api/courses/${courseId}/${assignmentId}/group-problems/problem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ problemId: pid }),
          });

          if (gpRes.ok) {
            const gpData = await gpRes.json().catch(() => ({}));
            const mappedGroups: string[] = Array.isArray(gpData?.groups) ? gpData.groups : [];

            if (mappedGroups.length === 0) {
              // No remaining group mappings — delete the assignment-level link as well
              const remRes = await fetch(`/api/courses/${courseId}/${assignmentId}/remove-problem`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ problemId: pid }),
              });

              if (!remRes.ok) {
                const txt = await remRes.text().catch(() => remRes.statusText);
                throw new Error(`Failed to remove problem from assignment after group deletion: ${txt || remRes.status}`);
              }
            }
          }
        }
      }

      // Only include problems the user newly added in this dialog (moved from right -> left)
      const newProblemIds = Array.from(new Set(movedProblems.map((p) => p.id).filter((id) => !removedProblemIds.includes(id))));
      let groupIdToSend = selectedGroupId === 'ALL' ? undefined : selectedGroupId;

      // If there are new problems, clean up any existing group mappings for those
      if (newProblemIds.length > 0) {
        for (const pid of newProblemIds) {
          const res = await fetch(`/api/courses/${courseId}/${assignmentId}/group-problems/problem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ problemId: pid }),
          });

          if (!res.ok) continue; // nothing to do for this problem

          const data = await res.json();
          const mappedGroups: string[] = Array.isArray(data?.groups) ? data.groups : [];

          if (mappedGroups.length > 0 && ((!groupIdToSend) || mappedGroups.length + 1 === groups.length)) {
            for (const gid of mappedGroups) {
              const delRes = await fetch(`/api/courses/${courseId}/${assignmentId}/group-problems/problem`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ problemId: pid, groupId: gid }),
              });
              if (!delRes.ok) {
                const txt = await delRes.text().catch(() => delRes.statusText);
                throw new Error(`Failed to remove existing group mapping: ${txt || delRes.status}`);
              }
            }
            // If we removed mappings for all groups, we'll save the problem as an assignment-level problem
            groupIdToSend = undefined;
          }
        }

        // Persist assignment / group assignment changes for only the newly added problems
        const addRes = await fetch(`/api/courses/${courseId}/${assignmentId}/add-problems`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ problemIds: newProblemIds, groupId: groupIdToSend }),
        });

        if (!addRes.ok) {
          const txt = await addRes.text().catch(() => addRes.statusText);
          throw new Error(`Failed to save problems: ${txt || addRes.status}`);
        }
      }

      showToast.success('Problems updated');
      setInternalOpen(false);
      onClose();
    } catch (err: any) {
      console.error('AssociateProblemsDialog.handleAdd error:', err);
      showToast.error(err?.message ?? 'Failed to update problems');
    } finally {
      setSubmitting(false);
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
        className="bg-card !max-w-2xl"
        onInteractOutside={(e) => { if (submitting) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (submitting) e.preventDefault(); }}
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
                        // Allow removal if the problem was just moved OR if it was originally mapped to this specific group
                        const isOriginallyMappedToGroup = selectedGroupId !== 'ALL' && (groupProblemsMap[selectedGroupId] || []).includes(problem.id);
                        const isRemovable = movedIds.has(problem.id) || isOriginallyMappedToGroup;

                        return (
                          <div
                            key={problem.id}
                            className={`bg-background flex items-center rounded border px-1.5 py-1 transition ${isRemovable && !submitting ? 'cursor-pointer hover:bg-red-100' : 'opacity-70'}`}
                            style={{ minHeight: '32px' }}
                            onClick={isRemovable && !submitting ? () => removeFromAssignment(problem) : undefined}
                            tabIndex={isRemovable && !submitting ? 0 : -1}
                            role={isRemovable && !submitting ? 'button' : undefined}
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
                    {allProblems.length === 0 ? (
                      <div className="text-muted-foreground text-center text-xs italic">None</div>
                    ) : (
                      (() => {
                        const leftIdsSet = new Set(leftProblems.map((p) => p.id));
                        return allProblems.map((problem) => {
                          const isSelected = leftIdsSet.has(problem.id);
                          return (
                            <div
                              key={problem.id}
                              className={`bg-background flex items-center rounded border px-1.5 py-1 transition ${isSelected || submitting ? 'opacity-60 pointer-events-none bg-primary/10' : 'hover:bg-green-100 cursor-pointer'}`}
                              style={{ minHeight: '32px' }}
                              onClick={() => {
                                if (isSelected || submitting) return;

                                // Re-add a problem the user previously removed in this dialog
                                if (removedProblemIds.includes(problem.id)) {
                                  // Undo the removal for this group
                                  setRemovedProblemIds((prev) => prev.filter((id) => id !== problem.id));

                                  // If this was originally assigned to this group, restore it in the local map
                                  if (originalAssignedIds.has(problem.id) && selectedGroupId !== 'ALL') {
                                    setGroupProblemsMap((prev) => ({
                                      ...prev,
                                      [selectedGroupId]: Array.from(new Set([...(prev[selectedGroupId] ?? []), problem.id])),
                                    }));
                                    return;
                                  }

                                  // Otherwise treat as a re-add from right -> left
                                  if (!movedIds.has(problem.id)) setMovedProblems((prev) => [...prev, problem]);
                                  return;
                                }

                                // Normal add from right -> left for non-original problems
                                if (!movedIds.has(problem.id)) {
                                  setMovedProblems((prev) => [...prev, problem]);
                                }
                              }}
                              tabIndex={isSelected || submitting ? -1 : 0}
                              role={isSelected || submitting ? undefined : 'button'}
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
                            const p = allProblems.find((x) => x.id === pid);
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
                {allProblems.length === 0 ? (
                  <div className="text-muted-foreground text-center text-xs italic">None</div>
                ) : (
                  (() => {
                    const leftIdsSet = new Set(leftProblems.map((p) => p.id));
                    return allProblems.map((problem) => {
                      const isSelected = leftIdsSet.has(problem.id);
                      return (
                        <div
                          key={problem.id}
                          className={`bg-background flex items-center rounded border px-1.5 py-1 transition ${isSelected || submitting ? 'opacity-60 cursor-not-allowed bg-primary/10' : 'hover:bg-green-100 cursor-pointer'}`}
                          style={{ minHeight: '32px' }}
                          onClick={() => {
                            if (isSelected || submitting) return;

                            if (removedProblemIds.includes(problem.id)) {
                              setRemovedProblemIds((prev) => prev.filter((id) => id !== problem.id));
                              return;
                            }

                            if (!movedIds.has(problem.id)) setMovedProblems((prev) => [...prev, problem]);
                          }}
                          tabIndex={isSelected || submitting ? -1 : 0}
                          role={isSelected || submitting ? undefined : 'button'}
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
                          isRemovable && !submitting ? 'cursor-pointer hover:bg-red-100' : 'opacity-70'
                        }`}
                        style={{ minHeight: '32px' }}
                        onClick={isRemovable && !submitting ? () => removeFromAssignment(problem) : undefined}
                        tabIndex={isRemovable && !submitting ? 0 : -1}
                        role={isRemovable && !submitting ? 'button' : undefined}
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
            disabled={submitting}
            onClick={() => {
              if (!submitting) {
                setInternalOpen(false);
                onClose();
              }
            }}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            disabled={submitting || (movedProblems.length === 0 && removedProblemIds.length === 0) || courseIsArchived}
            onClick={submitting ? undefined : handleAdd}
          >
            {submitting ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
