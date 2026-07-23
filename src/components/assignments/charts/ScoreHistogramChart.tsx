'use client';

import { useMemo } from 'react';
import type { HistogramBin } from '@/lib/assignment-statistics';
import {
  ChartDataTable,
  ChartTooltip,
  fmt1,
  fmtPct,
  useChartTooltip,
  useMeasuredWidth,
} from './chart-utils';

type Props = {
  bins: HistogramBin[];
  mean: number | null;
  median: number | null;
  includedCount: number;
  /** e.g. "students" or "groups"; used in the tooltip and accessible text. */
  unitPlural: string;
};

const HEIGHT = 300;
const M = { top: 16, right: 14, bottom: 40, left: 40 };

/** Choose a whole-number y tick step that yields ~4-5 ticks. */
function niceStep(max: number): number {
  if (max <= 5) return 1;
  const rough = max / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (pow * m >= rough) return pow * m;
  }
  return pow * 10;
}

export function ScoreHistogramChart({ bins, mean, median, includedCount, unitPlural }: Props) {
  const [ref, width] = useMeasuredWidth();
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();

  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const yMax = Math.max(1, ...bins.map((b) => b.count));
  const step = niceStep(yMax);
  const yTop = Math.ceil(yMax / step) * step;

  const xOf = (pct: number) => M.left + (pct / 100) * plotW;
  const yOf = (count: number) => M.top + plotH * (1 - count / yTop);

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let v = 0; v <= yTop; v += step) ticks.push(v);
    return ticks;
  }, [yTop, step]);

  const barGap = (plotW / bins.length) * 0.18;
  const barW = plotW / bins.length - barGap;

  return (
    <div
      ref={ref}
      className="w-full"
      role="group"
      aria-label={`Histogram of assignment scores for ${includedCount} ${unitPlural}, in 10 percent ranges.`}
    >
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="max-w-full overflow-visible"
      >
        {/* y gridlines + labels (decorative: the data lives in the focusable bars and the
            hidden data table, so keep these out of the accessibility tree) */}
        {yTicks.map((t) => (
          <g key={t} aria-hidden="true">
            <line
              x1={M.left}
              x2={M.left + plotW}
              y1={yOf(t)}
              y2={yOf(t)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={M.left - 6}
              y={yOf(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {t}
            </text>
          </g>
        ))}

        {/* x axis ticks at 0,10,...,100 (decorative) */}
        {Array.from({ length: 11 }, (_, i) => i * 10).map((t) => (
          <text
            key={t}
            x={xOf(t)}
            y={M.top + plotH + 16}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
            aria-hidden="true"
          >
            {t}
          </text>
        ))}

        {/* bars */}
        {bins.map((b, i) => {
          const x = M.left + (i / bins.length) * plotW + barGap / 2;
          const h = plotH - (yOf(b.count) - M.top);
          const pct = fmtPct(b.count, includedCount);
          const label = `${b.label}: ${b.count} ${unitPlural} (${pct})`;
          return (
            <rect
              key={b.label}
              x={x}
              y={yOf(b.count)}
              width={Math.max(0, barW)}
              height={Math.max(0, h)}
              rx={2}
              className="fill-brand-teal outline-none focus-visible:[outline:2px_solid_var(--color-ring)]"
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

        {/* reference lines: mean and median */}
        {mean != null && (
          <line
            x1={xOf(mean)}
            x2={xOf(mean)}
            y1={M.top}
            y2={M.top + plotH}
            className="stroke-primary"
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />
        )}
        {median != null && (
          <line
            x1={xOf(median)}
            x2={xOf(median)}
            y1={M.top}
            y2={M.top + plotH}
            className="stroke-tertiary"
            strokeWidth={1.5}
            strokeDasharray="2 3"
          />
        )}

        {/* axis labels (decorative; the group's aria-label and data table carry the meaning) */}
        <text
          x={M.left + plotW / 2}
          y={HEIGHT - 4}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
          aria-hidden="true"
        >
          Assignment score (%)
        </text>
        <text
          transform={`translate(11 ${M.top + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
          aria-hidden="true"
        >
          Number of {unitPlural}
        </text>
      </svg>

      {/* legend for the reference lines */}
      {(mean != null || median != null) && (
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {mean != null && (
            <span className="flex items-center gap-1.5">
              <svg width="20" height="8" aria-hidden="true">
                <line
                  x1="0"
                  y1="4"
                  x2="20"
                  y2="4"
                  className="stroke-primary"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                />
              </svg>
              Mean {fmt1(mean)}%
            </span>
          )}
          {median != null && (
            <span className="flex items-center gap-1.5">
              <svg width="20" height="8" aria-hidden="true">
                <line
                  x1="0"
                  y1="4"
                  x2="20"
                  y2="4"
                  className="stroke-tertiary"
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                />
              </svg>
              Median {fmt1(median)}%
            </span>
          )}
        </div>
      )}

      <ChartDataTable
        caption={`Assignment score distribution across ${includedCount} ${unitPlural}.`}
        headers={['Score range', `Number of ${unitPlural}`, 'Percent']}
        rows={bins.map((b) => [b.label, b.count, fmtPct(b.count, includedCount)])}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
