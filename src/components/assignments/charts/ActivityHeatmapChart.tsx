'use client';

import { Fragment } from 'react';
import { heatmapLevel, type HeatmapLevel } from '@/lib/assignment-statistics';
import { ChartDataTable, ChartTooltip, useChartTooltip } from './chart-utils';

type Props = {
  /** matrix[day 0=Sun..6=Sat][hour 0..23]. */
  matrix: number[][];
  max: number;
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

// Five-level teal ramp. Level 0 (no submissions) is a faint neutral so the whole 7x24
// grid reads as a continuous matrix, not scattered dots. Levels 1..4 deepen with activity.
const LEVEL_STYLE: { bg: string; opacity: number }[] = [
  { bg: 'var(--color-muted-foreground)', opacity: 0.1 },
  { bg: 'var(--color-brand-teal)', opacity: 0.28 },
  { bg: 'var(--color-brand-teal)', opacity: 0.5 },
  { bg: 'var(--color-brand-teal)', opacity: 0.72 },
  { bg: 'var(--color-brand-teal)', opacity: 1 },
];

/** 24-hour label like "2 PM", "12 AM". */
function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${period}`;
}

/** One-hour range like "4-5 AM" or "11 PM-12 AM". */
function hourRange(h: number): string {
  const start = hourLabel(h);
  const end = hourLabel((h + 1) % 24);
  const [sN, sP] = start.split(' ');
  const [eN, eP] = end.split(' ');
  return sP === eP ? `${sN}-${eN} ${sP}` : `${start}-${end}`;
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
          className="grid min-w-[34rem] gap-[3px]"
          style={{ gridTemplateColumns: `2.25rem repeat(24, minmax(0, 1fr))` }}
        >
          {DAYS_SHORT.map((day, d) => (
            <Fragment key={day}>
              <div className="text-muted-foreground flex items-center pr-1 text-[10px]">{day}</div>
              {HOURS.map((h) => {
                const count = matrix[d]?.[h] ?? 0;
                const level: HeatmapLevel = heatmapLevel(count, max);
                const style = LEVEL_STYLE[level]!;
                const label = `${DAYS_LONG[d]}, ${hourRange(h)}: ${count} submission${count === 1 ? '' : 's'}`;
                return (
                  <div
                    key={h}
                    className="h-5 rounded-[2px] outline-none focus-visible:[outline:2px_solid_var(--color-ring)]"
                    style={{ backgroundColor: style.bg, opacity: style.opacity }}
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
            </Fragment>
          ))}

          {/* hour axis: a label every 3 hours, aligned under the grid columns */}
          <div />
          {HOURS.map((h) => (
            <div
              key={h}
              className="text-muted-foreground overflow-visible text-center text-[9px] whitespace-nowrap"
              aria-hidden="true"
            >
              {h % 3 === 0 ? hourLabel(h) : ''}
            </div>
          ))}
        </div>
      </div>

      {/* Legend: fewer -> more */}
      <div className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
        <span>Fewer</span>
        {LEVEL_STYLE.map((style, i) => (
          <span
            key={i}
            className="inline-block h-3 w-3 rounded-[2px]"
            style={{ backgroundColor: style.bg, opacity: style.opacity }}
            aria-hidden="true"
          />
        ))}
        <span>More</span>
      </div>

      <ChartDataTable
        caption={`Submissions by day of week and hour, for ${unitPlural}.`}
        headers={['Day', ...HOURS.map((h) => hourLabel(h))]}
        rows={DAYS_SHORT.map((day, d) => [day, ...HOURS.map((h) => matrix[d]?.[h] ?? 0)])}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
