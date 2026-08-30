'use client';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

export type PickableProblem = {
  id: string;
  title?: string;
  maxPoints?: number | null;
};

type ProblemPickerProps = {
  problems: PickableProblem[];
  selectedProblemId: string | null;
  onSelect: (problemId: string) => void;
  /** The selected student's grade per problem. A missing or null entry means ungraded. */
  grades: Record<string, number | null>;
  className?: string;
};

/** "8/10", or "—/10" when nobody has graded it yet. */
function gradeLabel(grade: number | null | undefined, maxPoints?: number | null): string {
  const earned = typeof grade === 'number' ? String(grade) : '—';
  return typeof maxPoints === 'number' ? `${earned}/${maxPoints}` : earned;
}

/**
 * Choose which problem to review, and see at a glance which ones still need grading.
 *
 * This replaces the standing list of problems, so it has to carry what that list carried:
 * every problem, its grade, and whether it is done. A picker that only named the current
 * problem would answer "where am I" while losing "what is left", which is the question a
 * grader working through a student actually has.
 *
 * Status is shown three ways on purpose. Colour alone fails anyone with a red-green
 * deficiency, so the dot is also filled versus hollow, and the grade reads "—/10" rather than
 * a number when nothing has been entered.
 */
export function ProblemPicker({
  problems,
  selectedProblemId,
  onSelect,
  grades,
  className = '',
}: ProblemPickerProps) {
  const selected = problems.find((p) => p.id === selectedProblemId) ?? problems[0] ?? null;
  const selectedIndex = selected ? problems.findIndex((p) => p.id === selected.id) : -1;
  const step = (delta: number) => {
    if (problems.length === 0 || selectedIndex < 0) return;
    const next = (selectedIndex + delta + problems.length) % problems.length;
    const target = problems[next];
    if (target) onSelect(target.id);
  };
  const ungradedCount = problems.filter((p) => typeof grades[p.id] !== 'number').length;

  return (
    <div className={`flex w-full min-w-0 flex-col gap-1 ${className}`}>
      <span className="text-muted-foreground text-xs font-medium">Problem</span>
      <div className="flex w-full min-w-0 items-center">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => step(-1)}
          aria-label="Previous problem"
          title="Previous problem"
          className="shrink-0 rounded-r-none"
          disabled={problems.length < 2}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              // Matches the student picker beside it: same surface, same shape, a status dot
              // and a position readout. They are the same kind of control and should not look
              // like two different ones.
              className="bg-card text-foreground border-border hover:bg-accent flex min-w-0 flex-1 items-center gap-2 rounded-none border-x-0"
              aria-label={
                ungradedCount > 0
                  ? `Problem: ${selected?.title ?? 'none selected'}. ${ungradedCount} still need grading.`
                  : `Problem: ${selected?.title ?? 'none selected'}. All graded.`
              }
            >
              {selected ? (
                <span
                  aria-hidden="true"
                  className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 ${
                    typeof grades[selected.id] === 'number'
                      ? 'border-status-success-solid bg-status-success-solid'
                      : 'border-status-danger-solid bg-transparent'
                  }`}
                />
              ) : null}
              <span className="truncate">
                {selected
                  ? `${problems.findIndex((p) => p.id === selected.id) + 1}. ${selected.title ?? ''}`
                  : 'Select problem'}
              </span>
              {selected && problems.length > 0 ? (
                <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                  {problems.findIndex((p) => p.id === selected.id) + 1} of {problems.length}
                </span>
              ) : null}
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72">
            {problems.map((problem, index) => {
              const grade = grades[problem.id];
              const graded = typeof grade === 'number';
              return (
                <DropdownMenuItem
                  key={problem.id}
                  className="hover:bg-accent gap-2"
                  onClick={() => onSelect(problem.id)}
                >
                  {/* Filled when graded, hollow when not: a shape difference as well as a
                    colour one, so the state survives a monochrome or colour-blind reading. */}
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 ${
                      graded
                        ? 'border-status-success-solid bg-status-success-solid'
                        : 'border-status-danger-solid bg-transparent'
                    }`}
                  />
                  <span className="truncate">
                    {index + 1}. {problem.title || `Problem ${index + 1}`}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                    {gradeLabel(grade, problem.maxPoints)}
                  </span>
                  <span className="sr-only">{graded ? 'Graded' : 'Needs grading'}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => step(1)}
          aria-label="Next problem"
          title="Next problem"
          className="shrink-0 rounded-l-none"
          disabled={problems.length < 2}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export default ProblemPicker;
