'use client';

import { ChartDataTable, ChartTooltip, fmtPct, useChartTooltip } from './chart-utils';

/**
 * One 100% stacked bar per row, with a shared legend and a data table.
 *
 * Two cards on the Statistics tab ask the same shape of question about every problem: split
 * these participants into a handful of named buckets. What differs between them is only the
 * buckets and the words, so those are passed in and the geometry, the tooltip, the focus
 * behaviour and the table are decided once. Colour is never the only channel: every segment
 * carries an accessible name, the legend spells the buckets out, and the table repeats the
 * numbers.
 */

export type SegmentedSeries<Key extends string> = {
  id: string;
  /** Row label, e.g. a problem title. */
  label: string;
  segments: { key: Key; count: number }[];
};

type Props<Key extends string> = {
  /** One bar per entry (per problem). */
  series: SegmentedSeries<Key>[];
  /** Total assigned participants (the denominator for every row). */
  total: number;
  /** e.g. "students" or "groups". */
  unitPlural: string;
  /** The buckets, in display and legend order. */
  order: readonly Key[];
  /** Plain-language name per bucket. */
  labels: Record<Key, string>;
  /** Background utility class per bucket. */
  styles: Record<Key, string>;
  /** What one row is about, e.g. "Submission status": used in each bar's accessible name. */
  rowLabel: string;
  /** The data table's caption. */
  caption: string;
  /** The data table's first column heading. */
  rowHeader: string;
};

function Row<Key extends string>({
  row,
  total,
  unitPlural,
  order,
  labels,
  styles,
  rowLabel,
  onShow,
  onShowEl,
  onHide,
}: Pick<Props<Key>, 'total' | 'unitPlural' | 'order' | 'labels' | 'styles' | 'rowLabel'> & {
  row: SegmentedSeries<Key>;
  onShow: (e: { clientX: number; clientY: number }, content: string) => void;
  onShowEl: (el: Element, content: string) => void;
  onHide: () => void;
}) {
  const byKey = new Map(row.segments.map((s) => [s.key, s.count]));

  return (
    <div>
      <div className="text-foreground mb-1 truncate text-xs font-medium" title={row.label}>
        {row.label}
      </div>
      <div
        className="border-border flex h-7 w-full overflow-hidden rounded-md border"
        role="group"
        aria-label={`${rowLabel} for ${row.label}, across ${total} ${unitPlural}.`}
      >
        {order
          .map((key) => ({ key, count: byKey.get(key) ?? 0 }))
          .filter((s) => s.count > 0)
          .map((s) => {
            const pct = (s.count / total) * 100;
            const label = `${row.label}, ${labels[s.key]}: ${s.count} ${unitPlural} (${fmtPct(s.count, total)})`;
            return (
              <div
                key={s.key}
                className={`${styles[s.key]} outline-none focus-visible:[outline:2px_solid_var(--color-ring)] focus-visible:[outline-offset:-2px]`}
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

export function SegmentedBarChart<Key extends string>({
  series,
  total,
  unitPlural,
  order,
  labels,
  styles,
  rowLabel,
  caption,
  rowHeader,
}: Props<Key>) {
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();

  if (total === 0 || series.length === 0) return null;

  return (
    <div className="w-full">
      <div className="space-y-3">
        {series.map((row) => (
          <Row
            key={row.id}
            row={row}
            total={total}
            unitPlural={unitPlural}
            order={order}
            labels={labels}
            styles={styles}
            rowLabel={rowLabel}
            onShow={showAtEvent}
            onShowEl={showAtElement}
            onHide={hide}
          />
        ))}
      </div>

      {/* One shared legend for every row (also carries the labels, so colour isn't the only cue). */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {order.map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <span className={`${styles[key]} inline-block h-3 w-3 rounded-sm`} aria-hidden="true" />
            <span className="text-foreground">{labels[key]}</span>
          </li>
        ))}
      </ul>

      <ChartDataTable
        caption={caption}
        headers={[rowHeader, ...order.map((k) => labels[k])]}
        rows={series.map((row) => {
          const byKey = Object.fromEntries(row.segments.map((s) => [s.key, s.count]));
          return [row.label, ...order.map((k) => byKey[k] ?? 0)];
        })}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
