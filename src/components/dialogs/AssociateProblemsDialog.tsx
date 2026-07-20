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
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import SwitchField from '@/components/ui/SwitchField';
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
  // Returns a Promise so the dialog can await the parent-side API operation
  // (no Promise.resolve wrapper needed).
  onAddProblems: (
    problemIds: string[],
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

  const [internalOpen, setInternalOpen] = React.useState(false);

  React.useEffect(() => {
    let aborted = false;
    const ac = new AbortController();

    async function init() {
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

      // Refresh the authoritative problem list for this course when the dialog
      // opens so deleted problems don't remain selectable in the UI.
      try {
        if (courseId) {
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
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError')
          console.error('Failed to fetch problems for dialog:', err);
        setLocalAllProblems(allProblems);
      }

      if (!aborted) setInternalOpen(true);
    }

    if (open) {
      void init();
    } else {
      setInternalOpen(false);
    }

    return () => {
      aborted = true;
      ac.abort();
    };
  }, [open, courseId, defaultMaxPoints, defaultMaxSubmissions, defaultAutograderEnabled, allProblems]);

  const assignmentProblemIds = React.useMemo(
    () => new Set(usedProblems.map((p) => p.id)),
    [usedProblems],
  );

  // Available problems: everything in the course not already on the assignment.
  const selectableProblems = React.useMemo(() => {
    return localAllProblems.filter((p) => !assignmentProblemIds.has(p.id));
  }, [localAllProblems, assignmentProblemIds]);

  // Keep the dialog in sync with external changes while it's open (e.g. a problem
  // removed or deleted elsewhere) so the picker won't show stale/deleted problems.
  React.useEffect(() => {
    if (!internalOpen || !courseId) return;
    let aborted = false;
    const ac = new AbortController();

    async function syncExternal() {
      try {
        const pRes = await fetch(apiPaths.course(String(courseId), { view: 'problems' }), {
          signal: ac.signal,
        });
        if (!aborted && pRes.ok) {
          const pData = await pRes.json();
          const list = Array.isArray(pData?.problems) ? pData.problems : [];
          setLocalAllProblems(list);
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

    try {
      await onAddProblems([selectedProblem.id], settings);

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
          {configError ? (
            <p role="alert" className="text-xs text-red-600">
              {configError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setInternalOpen(false);
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
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
