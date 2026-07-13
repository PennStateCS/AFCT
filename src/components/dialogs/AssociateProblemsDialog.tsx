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
import { Input } from '@/components/ui/input';
import InputGroup from '@/components/ui/InputGroup';
import { Label } from '@/components/ui/label';
import SelectField from '@/components/ui/SelectField';
import SwitchField from '@/components/ui/SwitchField';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Search as SearchIcon, Check } from 'lucide-react';
import { apiPaths } from '@/lib/api-paths';
import { ProblemAssociationSettingsArray } from '@/schemas/problem';

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
  onAddProblems: (
    problemIds: string[],
    groupId?: string,
    problemSettings?: ProblemSettingsPayload[],
  ) => void | Promise<void>;
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
  // Local copy of course problems. We refresh this on open and whenever the
  // parent `allProblems` prop changes so deleted problems are removed
  // immediately from the dialog UI and any local "moved" state is cleaned up.
  const [localAllProblems, setLocalAllProblems] = React.useState<Problem[]>(allProblems);
  React.useEffect(() => {
    setLocalAllProblems(allProblems);
  }, [allProblems]);

  // Groups and group-assignment mapping
  const [assignmentIsGroup, setAssignmentIsGroup] = React.useState(false);
  const [groups, setGroups] = React.useState<{ id: string; name: string }[]>([]);
  const [groupsLoading, setGroupsLoading] = React.useState(false);
  const [selectedGroupId, setSelectedGroupId] = React.useState<'ALL' | string>('ALL');
  const [groupFilter, setGroupFilter] = React.useState('');
  const [groupProblemsMap, setGroupProblemsMap] = React.useState<Record<string, string[]>>({});
  const [selectedProblemToAdd, setSelectedProblemToAdd] = React.useState<string>('');
  const [newProblemMaxPoints, setNewProblemMaxPoints] = React.useState<string>(
    String(defaultMaxPoints ?? 100),
  );
  const defaultUnlimited =
    defaultMaxSubmissions === undefined ? true : defaultMaxSubmissions === -1;
  const [newProblemUnlimited, setNewProblemUnlimited] = React.useState<boolean>(defaultUnlimited);
  const [newProblemMaxSubmissions, setNewProblemMaxSubmissions] = React.useState<string>(
    String(
      defaultUnlimited
        ? 1
        : Math.max(
            1,
            Number.isFinite(defaultMaxSubmissions) ? (defaultMaxSubmissions as number) : 1,
          ),
    ),
  );
  const [newProblemAutograderEnabled, setNewProblemAutograderEnabled] = React.useState<boolean>(
    defaultAutograderEnabled ?? true,
  );
  const [configError, setConfigError] = React.useState<string | null>(null);

  // Initialize dialog only after we know which viewer to show (group-based or not)
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [initializing, setInitializing] = React.useState(false);

  React.useEffect(() => {
    let aborted = false;
    const ac = new AbortController();

    async function init() {
      setInitializing(true);
      setInternalOpen(false);
      setSelectedProblemToAdd('');
      setNewProblemMaxPoints(String(defaultMaxPoints ?? 100));
      setNewProblemUnlimited(
        defaultMaxSubmissions === undefined ? true : defaultMaxSubmissions === -1,
      );
      setNewProblemMaxSubmissions(
        String(
          (defaultMaxSubmissions ?? 1) === -1
            ? 1
            : Math.max(
                1,
                Number.isFinite(defaultMaxSubmissions) ? (defaultMaxSubmissions as number) : 1,
              ),
        ),
      );
      setNewProblemAutograderEnabled(defaultAutograderEnabled ?? true);
      setConfigError(null);
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
          const aRes = await fetch(apiPaths.assignment(courseId, assignmentId), {
            signal: ac.signal,
          });
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
            fetch(apiPaths.courseGroups(courseId)),
            fetch(apiPaths.assignmentGroupProblems(courseId, String(assignmentId))),
          ]);

          if (grRes.ok) {
            const gr = await grRes.json();
            setGroups(Array.isArray(gr) ? gr : (gr.groups ?? []));
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
          const pRes = await fetch(apiPaths.course(courseId, { view: 'problems' }), {
            signal: ac.signal,
          });
          if (pRes.ok) {
            const pData = await pRes.json();
            const list = Array.isArray(pData?.problems) ? pData.problems : [];
            setLocalAllProblems(list);
          } else {
            setLocalAllProblems(allProblems);
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name !== 'AbortError')
            console.error('Failed to fetch problems for dialog:', err);
          setLocalAllProblems(allProblems);
        }

        if (!aborted) {
          setInternalOpen(true);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
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

    if (open) void init();

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
  }, [
    open,
    courseId,
    assignmentId,
    defaultMaxPoints,
    defaultMaxSubmissions,
    defaultAutograderEnabled,
    allProblems,
  ]);

  // Determine which problems are originally assigned for the selected group (or overall assignment when ALL)
  const assignmentProblemIds = React.useMemo(
    () => new Set(usedProblems.map((p) => p.id)),
    [usedProblems],
  );

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

  // Available problems when group assignments are enabled
  const rightProblems = React.useMemo(() => {
    return localAllProblems.filter((p) => !originalAssignedIds.has(p.id));
  }, [localAllProblems, originalAssignedIds]);

  // Available problems for non-group assignments
  const unusedProblems = React.useMemo(() => {
    return localAllProblems.filter((p) => !assignmentProblemIds.has(p.id));
  }, [localAllProblems, assignmentProblemIds]);

  const selectableProblems = React.useMemo(
    () => (assignmentIsGroup ? rightProblems : unusedProblems),
    [assignmentIsGroup, rightProblems, unusedProblems],
  );

  // Reset pending add state when switching selected group
  React.useEffect(() => {
    setSelectedProblemToAdd('');
    setConfigError(null);
  }, [selectedGroupId]);

  // Keep the dialog in sync with external changes while it's open.
  // This covers cases where problems/group mappings are modified elsewhere
  // (removing a problem, deleting a problem, admin actions) so the UI won't show
  // stale mappings or deleted problems while user has the dialog open.
  React.useEffect(() => {
    if (!internalOpen) return;
    let aborted = false;
    const ac = new AbortController();

    async function syncExternal() {
      try {
        // Fetch latest course problems
        const pReq = fetch(apiPaths.course(String(courseId), { view: 'problems' }), {
          signal: ac.signal,
        });
        // Fetch group->problem mappings only for assignments that support groups.
        const gpReq = assignmentId
          ? fetch(apiPaths.assignmentGroupProblems(String(courseId), assignmentId), {
              signal: ac.signal,
            })
          : Promise.resolve(null);

        const [pRes, gpRes] = await Promise.all([pReq, gpReq]);

        if (!aborted) {
          if (pRes && pRes.ok) {
            const pData = await pRes.json();
            const list = Array.isArray(pData?.problems) ? pData.problems : [];
            setLocalAllProblems(list);
          }

          if (gpRes && gpRes.ok) {
            const gp = await gpRes.json();
            const map: Record<string, string[]> = {};
            for (const g of gp.groups ?? []) map[g.id] = g.problemIds || [];
            setGroupProblemsMap(map);
          }
        }
      } catch (err: unknown) {
        if (!(err instanceof Error) || err.name !== 'AbortError')
          console.error('Failed to sync AssociateProblemsDialog state:', err);
      }
    }

    void syncExternal();
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

  // If we're initializing, don't show the dialog yet; parent expects open to be controlled.
  // Render nothing while initializing to avoid flashing UI.
  if (initializing) return null;

  const handleAdd = async () => {
    setConfigError(null);

    if (!selectedProblemToAdd) {
      setConfigError('Select a problem first.');
      return;
    }

    const selectedProblem = selectableProblems.find(
      (problem) => problem.id === selectedProblemToAdd,
    );
    if (!selectedProblem) {
      setConfigError('Selected problem is no longer available.');
      return;
    }

    const maxPoints = Number(newProblemMaxPoints);
    const maxSubmissions = newProblemUnlimited ? -1 : Number(newProblemMaxSubmissions);

    const settings: ProblemSettingsPayload[] = [
      {
        problemId: selectedProblem.id,
        maxPoints,
        maxSubmissions,
        autograderEnabled: Boolean(newProblemAutograderEnabled),
      },
    ];

    // Validate the settings (points ≥ 0, submissions unlimited or an integer ≥ 1)
    // through the shared schema; it surfaces the same messages as before.
    const validation = ProblemAssociationSettingsArray.safeParse(settings);
    if (!validation.success) {
      setConfigError(
        validation.error.issues[0]?.message ?? 'Please review the problem settings.',
      );
      return;
    }

    const allProblemIds = [selectedProblem.id];
    const groupIdToSend = selectedGroupId === 'ALL' ? undefined : selectedGroupId;

    try {
      await onAddProblems(allProblemIds, groupIdToSend, settings);

      setInternalOpen(false);
      onClose();
    } catch (err) {
      console.error('Failed to add problems:', err);
      setInternalOpen(false);
      onClose();
    }
  };

  return (
    <Dialog open={internalOpen} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="bg-card"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add Existing Problem to Assignment</DialogTitle>
          <DialogDescription>Select one problem, configure it, then save.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
          {assignmentIsGroup && (
            <div>
              <Label className="mb-2 block">Assign To</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="border-input bg-background flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate text-left">
                      {selectedGroupId === 'ALL'
                        ? 'All Students'
                        : groups.find((g) => g.id === selectedGroupId)?.name || 'Select group'}
                    </span>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72 p-2">
                  <div className="relative">
                    <SearchIcon className="text-muted-foreground absolute top-3 left-3 h-4 w-4" />
                    <Input
                      className="pl-10"
                      placeholder="Search groups"
                      value={groupFilter}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setGroupFilter(e.target.value)
                      }
                    />
                  </div>
                  <div className="max-h-64 overflow-auto rounded-md">
                    <ul>
                      <li>
                        <button
                          type="button"
                          onClick={() => setSelectedGroupId('ALL')}
                          className={`hover:bg-primary/10 flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${selectedGroupId === 'ALL' ? 'bg-primary/10' : ''}`}
                        >
                          <div className="truncate">All students</div>
                          {selectedGroupId === 'ALL' && <Check className="h-4 w-4" />}
                        </button>
                      </li>
                      {groupsLoading ? (
                        <li className="text-muted-foreground p-3 text-sm">Loading…</li>
                      ) : groups.filter((g) =>
                          g.name.toLowerCase().includes(groupFilter.toLowerCase()),
                        ).length === 0 ? (
                        <li className="text-muted-foreground p-3 text-sm">No groups available</li>
                      ) : (
                        groups
                          .filter((g) => g.name.toLowerCase().includes(groupFilter.toLowerCase()))
                          .map((g) => (
                            <li key={g.id}>
                              <button
                                type="button"
                                onClick={() => setSelectedGroupId(g.id)}
                                className={`hover:bg-primary/10 flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${selectedGroupId === g.id ? 'bg-primary/10' : ''}`}
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
          )}

          <div className="space-y-4">
            <SelectField
              label="Problem"
              name="problem-selector"
              placeholder="Select a problem"
              value={selectedProblemToAdd}
              onValueChange={setSelectedProblemToAdd}
              options={selectableProblems.map((problem) => ({
                value: problem.id,
                label: problem.title,
              }))}
            />

            <InputGroup
              label="Max Points"
              name="associate-max-points"
              type="number"
              min={0}
              step="1"
              fieldProps={{
                value: newProblemMaxPoints,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  setNewProblemMaxPoints(e.target.value),
              }}
            />

            <div className="space-y-2">
              <SwitchField
                label="Unlimited Submissions"
                name="associate-unlimited-submissions"
                checked={newProblemUnlimited}
                onCheckedChange={setNewProblemUnlimited}
                description="When enabled, students are not limited in how many submissions they can make."
                descriptionPlacement="inline"
              />
              {!newProblemUnlimited && (
                <InputGroup
                  label="Max Submissions"
                  name="associate-max-submissions"
                  type="number"
                  min={1}
                  step="1"
                  fieldProps={{
                    value: newProblemMaxSubmissions,
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                      setNewProblemMaxSubmissions(e.target.value),
                  }}
                />
              )}
            </div>

            <div>
              <SwitchField
                label="Autograder"
                name="associate-autograder-enabled"
                checked={newProblemAutograderEnabled}
                onCheckedChange={setNewProblemAutograderEnabled}
                description="When enabled, students are automatically awarded the maximum points when the autograder returns true."
                descriptionPlacement="inline"
              />
            </div>
          </div>
          {configError ? <p className="text-xs text-red-600">{configError}</p> : null}

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
              disabled={courseIsArchived || selectableProblems.length === 0}
              onClick={handleAdd}
            >
              Add Problem
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
