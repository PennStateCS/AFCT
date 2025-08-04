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

type Problem = {
  id: string;
  title: string;
  description?: string;
  type?: string;
};

type AddProblemModalProps = {
  open: boolean;
  onClose: () => void;
  allProblems: Problem[];
  usedProblems: Problem[];
  onAddProblems: (problemIds: string[]) => void;
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
  allProblems,
  usedProblems,
  onAddProblems,
}: AddProblemModalProps) {
  const originalUsedIds = React.useMemo(
    () => new Set(usedProblems.map((p) => p.id)),
    [usedProblems],
  );
  const [movedProblems, setMovedProblems] = React.useState<Problem[]>([]);

  React.useEffect(() => {
    if (open) setMovedProblems([]);
  }, [open, allProblems, usedProblems]);

  const movedIds = new Set(movedProblems.map((p) => p.id));
  const unusedProblems = allProblems.filter(
    (p) => !originalUsedIds.has(p.id) && !movedIds.has(p.id),
  );
  const combinedUsedProblems = [...usedProblems, ...movedProblems];

  const handleDialogOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  // Remove a just-added problem from the right (put it back to available)
  const removeFromAssignment = (problem: Problem) => {
    setMovedProblems(movedProblems.filter((p) => p.id !== problem.id));
  };

  const handleAdd = () => {
    const allProblemIds = combinedUsedProblems.map((p) => p.id);
    onAddProblems(allProblemIds);
    setMovedProblems([]);
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
      <DialogContent className="bg-card !max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Existing Problems to Assignment</DialogTitle>
          <DialogDescription>
            Click a problem on the left to move it right; click a just-added problem on the right to
            move it back.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          {/* Unused Problems */}
          <Card className="flex w-1/2 flex-col p-2">
            <div className="font-semibold">Available Problems</div>
            <div className="flex max-h-72 min-h-[200px] flex-col gap-1 overflow-y-auto">
              {unusedProblems.length === 0 ? (
                <div className="text-muted-foreground text-center text-xs italic">None</div>
              ) : (
                unusedProblems.map((problem) => (
                  <div
                    key={problem.id}
                    className="bg-background hover:bg-primary/70 flex cursor-pointer items-center rounded border px-1.5 py-1 transition"
                    style={{ minHeight: '32px' }}
                    onClick={() => setMovedProblems([...movedProblems, problem])}
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
          {/* Used Problems */}
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
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" disabled={movedProblems.length === 0} onClick={handleAdd}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
