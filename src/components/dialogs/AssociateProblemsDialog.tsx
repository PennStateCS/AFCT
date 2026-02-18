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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, ArrowRight } from 'lucide-react';

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
  courseIsArchived: boolean;
  allProblems: Problem[];
  usedProblems: Problem[];
  onAddProblems: (problemSettings: ProblemSettingsPayload[]) => void;
  defaultMaxPoints?: number;
  defaultMaxSubmissions?: number;
  defaultAutograderEnabled?: boolean;
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
  const [pendingProblems, setPendingProblems] = React.useState<Problem[]>([]);
  const [approvedProblems, setApprovedProblems] = React.useState<Problem[]>([]);
  const [configByProblemId, setConfigByProblemId] = React.useState<Record<string, ProblemConfig>>(
    {},
  );

  const baseConfig = React.useMemo<ProblemConfig>(
    () => ({
      maxPoints: defaultMaxPoints ?? 0,
      maxSubmissions: defaultMaxSubmissions ?? -1,
      autograderEnabled: defaultAutograderEnabled ?? true,
    }),
    [defaultMaxPoints, defaultMaxSubmissions, defaultAutograderEnabled],
  );

  React.useEffect(() => {
    if (open) {
      setPendingProblems([]);
      setApprovedProblems([]);
      setConfigByProblemId({});
    }
  }, [open, allProblems, usedProblems]);

  const pipelineIds = new Set([...pendingProblems, ...approvedProblems].map((p) => p.id));
  const unusedProblems = allProblems.filter(
    (p) => !originalUsedIds.has(p.id) && !pipelineIds.has(p.id),
  );
  const saveDisabled = courseIsArchived || approvedProblems.length === 0;

  const handleDialogOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  const clearConfig = (problemId: string) => {
    setConfigByProblemId((prev) => {
      if (!prev[problemId]) return prev;
      const { [problemId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const upsertConfig = (problemId: string, partial: Partial<ProblemConfig>) => {
    setConfigByProblemId((prev) => ({
      ...prev,
      [problemId]: {
        ...(prev[problemId] ?? baseConfig),
        ...partial,
      },
    }));
  };

  const ensureConfigForProblem = (problemId: string) => {
    setConfigByProblemId((prev) => {
      if (prev[problemId]) return prev;
      return { ...prev, [problemId]: { ...baseConfig } };
    });
  };

  const handleSelectProblem = (problem: Problem) => {
    if (pipelineIds.has(problem.id)) return;
    if (pendingProblems.length > 0) return;
    setPendingProblems([problem]);
    ensureConfigForProblem(problem.id);
  };

  const isConfigInvalid = (problemId: string) => {
    const config = configByProblemId[problemId];
    if (!config) return true;
    if (!Number.isFinite(config.maxPoints) || config.maxPoints < 0) return true;
    if (!Number.isFinite(config.maxSubmissions)) return true;
    if (config.maxSubmissions !== -1 && config.maxSubmissions < 1) return true;
    return false;
  };

  const removeFromPending = (problem: Problem) => {
    setPendingProblems((prev) => prev.filter((p) => p.id !== problem.id));
    clearConfig(problem.id);
  };

  const removeFromApproved = (problem: Problem) => {
    setApprovedProblems((prev) => prev.filter((p) => p.id !== problem.id));
    clearConfig(problem.id);
  };

  const handleApproveProblem = (problem: Problem) => {
    if (isConfigInvalid(problem.id)) return;
    setPendingProblems((prev) => prev.filter((p) => p.id !== problem.id));
    setApprovedProblems((prev) => [...prev, problem]);
  };

  const handleEditApprovedProblem = (problem: Problem) => {
    setApprovedProblems((prev) => prev.filter((p) => p.id !== problem.id));
    setPendingProblems([problem]);
  };

  const handleAdd = () => {
    if (approvedProblems.length === 0) return;
    const payload: ProblemSettingsPayload[] = approvedProblems.map((problem) => ({
      problemId: problem.id,
      ...(configByProblemId[problem.id] ?? baseConfig),
    }));
    onAddProblems(payload);
    setPendingProblems([]);
    setApprovedProblems([]);
    setConfigByProblemId({});
    onClose();
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
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="bg-card !max-w-5xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Add Existing Problems to Assignment</DialogTitle>
          <DialogDescription>
            Select a problem, configure its limits in the middle column, then approve it so it moves
            into the Ready column. Only approved problems will be saved to this assignment.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 md:grid-cols-3">
          {/* Available Problems */}
          <Card className="flex flex-col p-2">
            <div className="font-semibold">Available Problems</div>
            <p className="text-muted-foreground text-xs">Select to configure.</p>
            <div className="mt-2 flex max-h-72 min-h-[200px] flex-col gap-1 overflow-y-auto">
              {unusedProblems.length === 0 ? (
                <div className="text-muted-foreground text-center text-xs italic">None</div>
              ) : (
                unusedProblems.map((problem) => (
                  <div
                    key={problem.id}
                    className="bg-background hover:bg-primary/70 flex cursor-pointer items-center rounded border px-1.5 py-1 transition"
                    style={{ minHeight: '32px' }}
                    onClick={() => handleSelectProblem(problem)}
                    tabIndex={0}
                    role="button"
                  >
                    <span className="truncate pr-2 text-xs font-medium">{problem.title}</span>
                    <AbbrevBadge type={problem.type} />
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Configure Column */}
          <Card className="flex flex-col gap-2 p-2">
            <div className="font-semibold">Configure & Approve</div>
            <p className="text-muted-foreground text-xs">
              Configure one problem at a time; approve it to move it into the Ready column.
            </p>
            <div className="mt-2 flex max-h-72 min-h-[200px] flex-col gap-2 overflow-y-auto">
              {pendingProblems.length === 0 ? (
                <div className="text-muted-foreground text-center text-xs italic">
                  Select an available problem to configure it here.
                </div>
              ) : (
                pendingProblems.map((problem) => {
                  const config = configByProblemId[problem.id] ?? baseConfig;
                  const isUnlimited = config.maxSubmissions === -1;
                  const configInvalid = isConfigInvalid(problem.id);
                  const maxPointsInvalid =
                    configInvalid && (!Number.isFinite(config.maxPoints) || config.maxPoints < 0);
                  const maxSubmissionsInvalid =
                    configInvalid &&
                    (!Number.isFinite(config.maxSubmissions) ||
                      (config.maxSubmissions !== -1 && config.maxSubmissions < 1));

                  return (
                    <div key={problem.id} className="bg-background/80 rounded border p-3 shadow-sm">
                      <div className="flex flex-1 items-center gap-2">
                        <span className="truncate text-sm font-semibold">{problem.title}</span>
                        <AbbrevBadge type={problem.type} />
                      </div>
                      <div className="mt-3 flex flex-col gap-3">
                        <div className="space-y-3">
                          <div>
                            <Label
                              htmlFor={`max-points-${problem.id}`}
                              className="text-xs font-semibold tracking-wide uppercase"
                            >
                              Max Points
                            </Label>
                            <Input
                              id={`max-points-${problem.id}`}
                              type="number"
                              min={0}
                              step="0.5"
                              value={config.maxPoints}
                              onChange={(event) => {
                                const next = Number(event.target.value);
                                upsertConfig(problem.id, {
                                  maxPoints: Number.isFinite(next) ? next : 0,
                                });
                              }}
                            />
                          </div>
                          <div>
                            <Label
                              htmlFor={`max-submissions-${problem.id}`}
                              className="text-xs font-semibold tracking-wide uppercase"
                            >
                              Max Submissions
                            </Label>
                            <div className="relative">
                              <Input
                                id={`max-submissions-${problem.id}`}
                                type="number"
                                min={1}
                                step="1"
                                value={isUnlimited ? '' : config.maxSubmissions}
                                onChange={(event) => {
                                  const next = Number(event.target.value);
                                  if (!Number.isFinite(next)) return;
                                  upsertConfig(problem.id, {
                                    maxSubmissions: Math.max(1, Math.floor(next)),
                                  });
                                }}
                                className={isUnlimited ? 'pr-20' : undefined}
                              />
                              {isUnlimited && (
                                <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs">
                                  Unlimited
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="bg-muted/40 flex items-center justify-between rounded border px-3 py-2">
                          <div>
                            <p className="text-xs font-semibold tracking-wide uppercase">
                              Autograder
                            </p>
                            <p className="text-muted-foreground text-xs">
                              Toggle to automatically award points based on the evaluator.
                            </p>
                          </div>
                          <Switch
                            checked={config.autograderEnabled}
                            onCheckedChange={(checked) =>
                              upsertConfig(problem.id, { autograderEnabled: checked })
                            }
                            aria-label="Autograder toggle"
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-red-600 hover:bg-red-50"
                          onClick={() => removeFromPending(problem)}
                        >
                          <ArrowLeft className="mr-1 h-4 w-4" /> Remove
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleApproveProblem(problem)}
                          disabled={configInvalid}
                        >
                          Approve <ArrowRight className="ml-1 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* Ready Column */}
          <Card className="flex flex-col gap-2 p-2">
            <div className="font-semibold">Ready to Add</div>
            <p className="text-muted-foreground text-xs">
              Approved problems will be saved to this assignment.
            </p>
            <div className="mt-2 flex max-h-72 min-h-[200px] flex-col gap-2 overflow-y-auto">
              {approvedProblems.length === 0 ? (
                <div className="text-muted-foreground text-center text-xs italic">
                  Approve a problem to see it here.
                </div>
              ) : (
                approvedProblems.map((problem) => {
                  const config = configByProblemId[problem.id] ?? baseConfig;
                  return (
                    <div key={problem.id} className="bg-background/80 rounded border p-3 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{problem.title}</p>
                          <div className="text-muted-foreground text-xs">
                            <span>Points: {config.maxPoints}</span>
                            <span className="mx-2">•</span>
                            <span>
                              Submissions:{' '}
                              {config.maxSubmissions === -1 ? 'Unlimited' : config.maxSubmissions}
                            </span>
                            <span className="mx-2">•</span>
                            <span>Autograder: {config.autograderEnabled ? 'On' : 'Off'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleEditApprovedProblem(problem)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-red-600 hover:bg-red-50"
                            onClick={() => removeFromApproved(problem)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" disabled={saveDisabled} onClick={handleAdd}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
