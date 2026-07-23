'use client';

import { STATUS_LABELS, type StatusKey } from '@/lib/assignment-statistics';
import { ChartDataTable, ChartTooltip, fmtPct, useChartTooltip } from './chart-utils';

type Props = {
  status: { key: StatusKey; count: number }[];
  total: number;
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

// Semantic-but-restrained colours from the app's badge palette (full light/dark support).
// on-time = positive, late = warning, in-progress = informational, missing = destructive,
// not-started = muted. Colour is never the only channel: labels sit in the legend and each
// segment carries an accessible name.
const STATUS_STYLE: Record<StatusKey, { seg: string; swatch: string }> = {
  'on-time': { seg: 'bg-badge-success', swatch: 'bg-badge-success' },
  late: { seg: 'bg-badge-warning', swatch: 'bg-badge-warning' },
  'in-progress': { seg: 'bg-badge-info', swatch: 'bg-badge-info' },
  missing: { seg: 'bg-badge-danger', swatch: 'bg-badge-danger' },
  'not-started': { seg: 'bg-badge-neutral', swatch: 'bg-badge-neutral' },
};

export function SubmissionStatusBar({ status, total, unitPlural }: Props) {
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();
  const segments = status.filter((s) => s.count > 0);

  if (total === 0) return null;

  return (
    <div className="w-full">
      <div
        className="border-border flex h-10 w-full overflow-hidden rounded-md border"
        role="group"
        aria-label={`Submission status for ${total} ${unitPlural}.`}
      >
        {segments.map((s) => {
          const pct = (s.count / total) * 100;
          const label = `${STATUS_LABELS[s.key]}: ${s.count} ${unitPlural} (${fmtPct(s.count, total)})`;
          return (
            <div
              key={s.key}
              className={`${STATUS_STYLE[s.key].seg} flex items-center justify-center overflow-hidden outline-none focus-visible:[outline:2px_solid_var(--color-ring)] focus-visible:[outline-offset:-2px]`}
              style={{ width: `${pct}%` }}
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

      {/* Legend: every status, so small/absent segments are still explained (not colour-only). */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {status.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              className={`${STATUS_STYLE[s.key].swatch} inline-block h-3 w-3 rounded-sm`}
              aria-hidden="true"
            />
            <span className="text-foreground">{STATUS_LABELS[s.key]}</span>
            <span className="text-muted-foreground">
              {s.count} ({fmtPct(s.count, total)})
            </span>
          </li>
        ))}
      </ul>

      <ChartDataTable
        caption={`Submission status across ${total} ${unitPlural}.`}
        headers={['Status', `Number of ${unitPlural}`, 'Percent']}
        rows={status.map((s) => [STATUS_LABELS[s.key], s.count, fmtPct(s.count, total)])}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
