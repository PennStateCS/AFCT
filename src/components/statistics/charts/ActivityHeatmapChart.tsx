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

// The shared sequential scale: colour here is a quantity, so it comes from
// --chart-sequential-* rather than the categorical chart-1..6. Level 0 (no submissions)
// stays a faint neutral so the whole 7x24 grid reads as a continuous matrix rather than
// scattered dots, and levels 1..4 take steps 2..5 rather than 1..5 for the same reason:
// step 1 is nearly white and would be indistinguishable from an empty cell.
//
// Full opacity, not one hue at 0.28/0.5/0.72/1 as before. That trick put the lightest
// active level at 1.3:1 against the card, and it is not a decision anybody can review.
const LEVEL_STYLE: { bg: string; opacity: number }[] = [
  { bg: 'var(--color-muted-foreground)', opacity: 0.1 },
  { bg: 'var(--color-chart-sequential-2)', opacity: 1 },
  { bg: 'var(--color-chart-sequential-3)', opacity: 1 },
  { bg: 'var(--color-chart-sequential-4)', opacity: 1 },
  { bg: 'var(--color-chart-sequential-5)', opacity: 1 },
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
  const { state, showAtEvent, hide } = useChartTooltip();

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
                  /*
                   * Not focusable, and not in the accessibility tree.
                   *
                   * This grid is 7 by 24. Making each cell a focus stop with a name of its own
                   * meant 168 tab stops to cross the chart and 168 announced images to read
                   * past it, which is a worse experience than no keyboard access at all. Every
                   * value is already in the `ChartDataTable` below, laid out as a real table
                   * with day and hour headers, so nothing is lost by leaving the picture to
                   * the people who can see it. The other charts keep their focusable hit areas
                   * because ten of them is a reasonable number; this one is not.
                   */
                  <div
                    key={h}
                    className="h-5 rounded-[2px]"
                    style={{ backgroundColor: style.bg, opacity: style.opacity }}
                    aria-hidden="true"
                    onMouseEnter={(e) => showAtEvent(e, label)}
                    onMouseMove={(e) => showAtEvent(e, label)}
                    onMouseLeave={hide}
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
