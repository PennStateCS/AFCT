'use client';

import { ChartDataTable, ChartTooltip, fmtPct, useChartTooltip } from './chart-utils';

export type FirstAttemptRow = {
  id: string;
  title: string;
  correct: number;
  submitted: number;
};

type Props = {
  problems: FirstAttemptRow[];
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

export function FirstAttemptChart({ problems, unitPlural }: Props) {
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();

  return (
    <div
      className="w-full"
      role="group"
      aria-label={`First-attempt success rate per problem, across the ${unitPlural} who submitted.`}
    >
      <div className="space-y-2">
        {problems.map((p) => {
          const pct = p.submitted > 0 ? (p.correct / p.submitted) * 100 : 0;
          const label =
            p.submitted > 0
              ? `${p.title}: ${p.correct} of ${p.submitted} ${unitPlural} correct on the first try (${fmtPct(p.correct, p.submitted)})`
              : `${p.title}: no submissions yet`;
          return (
            <div key={p.id} className="flex items-center gap-2">
              <div className="text-foreground w-24 shrink-0 truncate text-xs sm:w-36" title={p.title}>
                {p.title}
              </div>
              <div
                className="border-border bg-accent/40 relative h-6 min-w-0 flex-1 overflow-hidden rounded-md border outline-none focus-visible:[outline:2px_solid_var(--color-ring)]"
                tabIndex={0}
                role="img"
                aria-label={label}
                onMouseEnter={(e) => showAtEvent(e, label)}
                onMouseMove={(e) => showAtEvent(e, label)}
                onMouseLeave={hide}
                onFocus={(e) => showAtElement(e.currentTarget, label)}
                onBlur={hide}
              >
                {p.submitted > 0 && (
                  <div className="bg-brand-teal h-full rounded-l-md" style={{ width: `${pct}%` }} />
                )}
              </div>
              <div className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
                {p.submitted > 0 ? `${Math.round(pct)}%` : '-'}
              </div>
            </div>
          );
        })}
      </div>

      <ChartDataTable
        caption={`First-attempt success per problem, across the ${unitPlural} who submitted each problem.`}
        headers={['Problem', 'Correct first try', 'Submitted', 'Rate']}
        rows={problems.map((p) => [
          p.title,
          p.correct,
          p.submitted,
          p.submitted > 0 ? fmtPct(p.correct, p.submitted) : '-',
        ])}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
