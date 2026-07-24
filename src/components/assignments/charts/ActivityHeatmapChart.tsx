'use client';

import { Fragment } from 'react';
import { ChartDataTable, ChartTooltip, useChartTooltip } from './chart-utils';

type Props = {
  /** matrix[day 0=Sun..6=Sat][hour 0..23]. */
  matrix: number[][];
  max: number;
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** 24-hour label like "2 PM", "12 AM". */
function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${period}`;
}

export function ActivityHeatmapChart({ matrix, max, unitPlural }: Props) {
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();

  return (
    <div
      className="w-full"
      role="group"
      aria-label={`When ${unitPlural} submit: activity by day of week and hour.`}
    >
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[36rem] gap-0.5"
          style={{ gridTemplateColumns: `2.25rem repeat(24, minmax(0, 1fr))` }}
        >
          {DAYS.map((day, d) => (
            <Fragment key={day}>
              <div className="text-muted-foreground flex items-center pr-1 text-[10px]">{day}</div>
              {HOURS.map((h) => {
                const count = matrix[d]?.[h] ?? 0;
                // Transparent for an empty cell (only the border shows); otherwise a floor
                // of 0.3 so even a single submission is clearly visible, scaling to solid at
                // the busiest cell. Keep the raw 0 here: `opacity || undefined` would turn an
                // empty cell fully opaque (0 is falsy), which hides real activity.
                const opacity = count === 0 ? 0 : 0.3 + 0.7 * (max > 0 ? count / max : 0);
                const label = `${day} ${hourLabel(h)}: ${count} submission${count === 1 ? '' : 's'}`;
                return (
                  <div
                    key={h}
                    className="border-border/60 h-4 rounded-[2px] border outline-none focus-visible:[outline:2px_solid_var(--color-ring)]"
                    style={{ backgroundColor: 'var(--color-brand-teal)', opacity }}
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

              {/* one cell per column carries no data; render nothing extra */}
            </Fragment>
          ))}

          {/* hour axis: a label every 6 hours, aligned under the grid columns */}
          <div />
          {HOURS.map((h) => (
            <div
              key={h}
              className="text-muted-foreground text-center text-[9px]"
              aria-hidden="true"
            >
              {h % 6 === 0 ? hourLabel(h) : ''}
            </div>
          ))}
        </div>
      </div>

      <ChartDataTable
        caption={`Submissions by day of week and hour, for ${unitPlural}.`}
        headers={['Day', ...HOURS.map((h) => hourLabel(h))]}
        rows={DAYS.map((day, d) => [day, ...HOURS.map((h) => matrix[d]?.[h] ?? 0)])}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
