'use client';

import type { AttemptsToSolve } from '@/lib/assignment-statistics';
import { ChartDataTable, ChartTooltip, fmtPct, useChartTooltip } from './chart-utils';

export type AttemptsRow = {
  id: string;
  title: string;
  attempts: AttemptsToSolve;
};

type Props = {
  problems: AttemptsRow[];
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

// Light-to-dark teal ramp: 1 attempt (easy) is lightest, 5+ (grindy) is darkest. "Not
// solved yet" is a muted trailing segment so each bar covers everyone who submitted.
const BUCKET_STYLE = [
  { bg: 'var(--color-brand-teal)', opacity: 0.3 },
  { bg: 'var(--color-brand-teal)', opacity: 0.45 },
  { bg: 'var(--color-brand-teal)', opacity: 0.62 },
  { bg: 'var(--color-brand-teal)', opacity: 0.8 },
  { bg: 'var(--color-brand-teal)', opacity: 1 },
];
const NOT_SOLVED_STYLE = { bg: 'var(--color-muted-foreground)', opacity: 0.35 };

type Segment = { key: string; label: string; count: number; style: { bg: string; opacity: number } };

function segmentsFor(a: AttemptsToSolve): { segments: Segment[]; total: number } {
  const segments: Segment[] = a.buckets.map((b, i) => ({
    key: b.label,
    label: `solved in ${b.label} attempt${b.label === '1' ? '' : 's'}`,
    count: b.count,
    style: BUCKET_STYLE[i]!,
  }));
  segments.push({
    key: 'unsolved',
    label: 'not solved yet',
    count: a.unsolvedCount,
    style: NOT_SOLVED_STYLE,
  });
  return { segments, total: a.solvedCount + a.unsolvedCount };
}

export function AttemptsPerProblemChart({ problems, unitPlural }: Props) {
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();

  return (
    <div
      className="w-full"
      role="group"
      aria-label={`Attempts to solve each problem, across the ${unitPlural} who submitted.`}
    >
      <div className="space-y-3">
        {problems.map((p) => {
          const { segments, total } = segmentsFor(p.attempts);
          return (
            <div key={p.id}>
              <div className="text-foreground mb-1 truncate text-xs font-medium" title={p.title}>
                {p.title}
              </div>
              {total > 0 ? (
                <div
                  className="border-border flex h-6 w-full overflow-hidden rounded-md border"
                  role="group"
                  aria-label={`Attempts to solve ${p.title}, across ${total} ${unitPlural}.`}
                >
                  {segments
                    .filter((s) => s.count > 0)
                    .map((s) => {
                      const pct = (s.count / total) * 100;
                      const label = `${p.title} — ${s.label}: ${s.count} ${unitPlural} (${fmtPct(s.count, total)})`;
                      return (
                        <div
                          key={s.key}
                          className="outline-none focus-visible:[outline:2px_solid_var(--color-ring)] focus-visible:-outline-offset-2"
                          style={{ width: `${pct}%`, backgroundColor: s.style.bg, opacity: s.style.opacity }}
                          tabIndex={0}
                          role="img"
                          aria-label={label}
                          onMouseEnter={(e) => showAtEvent(e, label)}
                          onMouseMove={(e) => showAtEvent(e, label)}
                          onMouseLeave={hide}
                          onFocus={(e) => showAtElement(e.currentTarget, label)}
                          onBlur={hide}
                        />
                      );
                    })}
                </div>
              ) : (
                <div className="text-muted-foreground border-border flex h-6 items-center rounded-md border border-dashed px-2 text-xs">
                  No submissions yet
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* legend */}
      <ul className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {BUCKET_STYLE.map((style, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: style.bg, opacity: style.opacity }}
              aria-hidden="true"
            />
            <span className="text-foreground">{i === 4 ? '5+' : i + 1}</span>
          </li>
        ))}
        <li className="text-muted-foreground">attempts</li>
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: NOT_SOLVED_STYLE.bg, opacity: NOT_SOLVED_STYLE.opacity }}
            aria-hidden="true"
          />
          <span className="text-foreground">Not solved</span>
        </li>
      </ul>

      <ChartDataTable
        caption={`Attempts to solve each problem, across the ${unitPlural} who submitted.`}
        headers={['Problem', '1', '2', '3', '4', '5+', 'Not solved']}
        rows={problems.map((p) => [
          p.title,
          ...p.attempts.buckets.map((b) => b.count),
          p.attempts.unsolvedCount,
        ])}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
