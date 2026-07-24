'use client';

import { STATUS_LABELS, STATUS_ORDER, type StatusKey } from '@/lib/assignment-statistics';
import { ChartDataTable, ChartTooltip, fmtPct, useChartTooltip } from './chart-utils';

export type StatusSeries = {
  id: string;
  /** Row label, e.g. a problem title. */
  label: string;
  status: { key: StatusKey; count: number }[];
};

type Props = {
  /** One 100% status bar per entry (per problem). */
  series: StatusSeries[];
  /** Total assigned participants (the denominator for every row). */
  total: number;
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

// Semantic-but-restrained colours from the app's badge palette (full light/dark support).
// completed = positive, processing = informational, pending = warning (in the queue),
// failed = destructive, missing = muted. Colour is never the only channel: labels sit in
// the legend and each segment carries an accessible name.
const STATUS_STYLE: Record<StatusKey, string> = {
  completed: 'bg-badge-success',
  processing: 'bg-badge-info',
  pending: 'bg-badge-warning',
  failed: 'bg-badge-danger',
  missing: 'bg-badge-neutral',
};

function StatusRow({
  row,
  total,
  unitPlural,
  onShow,
  onShowEl,
  onHide,
}: {
  row: StatusSeries;
  total: number;
  unitPlural: string;
  onShow: (e: { clientX: number; clientY: number }, content: string) => void;
  onShowEl: (el: Element, content: string) => void;
  onHide: () => void;
}) {
  return (
    <div>
      <div className="text-foreground mb-1 truncate text-xs font-medium" title={row.label}>
        {row.label}
      </div>
      <div
        className="border-border flex h-7 w-full overflow-hidden rounded-md border"
        role="group"
        aria-label={`Submission status for ${row.label}, across ${total} ${unitPlural}.`}
      >
        {row.status
          .filter((s) => s.count > 0)
          .map((s) => {
            const pct = (s.count / total) * 100;
            const label = `${row.label} — ${STATUS_LABELS[s.key]}: ${s.count} ${unitPlural} (${fmtPct(s.count, total)})`;
            return (
              <div
                key={s.key}
                className={`${STATUS_STYLE[s.key]} outline-none focus-visible:[outline:2px_solid_var(--color-ring)] focus-visible:[outline-offset:-2px]`}
                style={{ width: `${pct}%` }}
                tabIndex={0}
                role="img"
                aria-label={label}
                onMouseEnter={(e) => onShow(e, label)}
                onMouseMove={(e) => onShow(e, label)}
                onMouseLeave={onHide}
                onFocus={(e) => onShowEl(e.currentTarget, label)}
                onBlur={onHide}
              />
            );
          })}
      </div>
    </div>
  );
}

export function SubmissionStatusBar({ series, total, unitPlural }: Props) {
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();

  if (total === 0 || series.length === 0) return null;

  return (
    <div className="w-full">
      <div className="space-y-3">
        {series.map((row) => (
          <StatusRow
            key={row.id}
            row={row}
            total={total}
            unitPlural={unitPlural}
            onShow={showAtEvent}
            onShowEl={showAtElement}
            onHide={hide}
          />
        ))}
      </div>

      {/* One shared legend for every row (also carries the labels, so colour isn't the only cue). */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {STATUS_ORDER.map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <span
              className={`${STATUS_STYLE[key]} inline-block h-3 w-3 rounded-sm`}
              aria-hidden="true"
            />
            <span className="text-foreground">{STATUS_LABELS[key]}</span>
          </li>
        ))}
      </ul>

      <ChartDataTable
        caption={`Submission status per problem, across ${total} ${unitPlural}.`}
        headers={['Problem', ...STATUS_ORDER.map((k) => STATUS_LABELS[k])]}
        rows={series.map((row) => {
          const byKey = Object.fromEntries(row.status.map((s) => [s.key, s.count]));
          return [row.label, ...STATUS_ORDER.map((k) => byKey[k] ?? 0)];
        })}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
