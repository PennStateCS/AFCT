'use client';

import type { AttemptsBucket } from '@/lib/assignment-statistics';
import { ChartDataTable, ChartTooltip, fmtPct, useChartTooltip, useMeasuredWidth } from './chart-utils';

type Props = {
  buckets: AttemptsBucket[];
  /** Pairs eventually solved (the histogram population, and the tooltip denominator). */
  solvedCount: number;
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

const HEIGHT = 240;
const M = { top: 12, right: 12, bottom: 34, left: 34 };

export function AttemptsHistogramChart({ buckets, solvedCount, unitPlural }: Props) {
  const [ref, width] = useMeasuredWidth(420);
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();

  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const yMax = Math.max(1, ...buckets.map((b) => b.count));
  const yOf = (count: number) => M.top + plotH * (1 - count / yMax);
  const gap = (plotW / buckets.length) * 0.25;
  const barW = plotW / buckets.length - gap;

  return (
    <div
      ref={ref}
      className="w-full"
      role="group"
      aria-label={`Attempts needed to solve, across ${solvedCount} solved ${unitPlural} problem pairs.`}
    >
      <svg width={width} height={HEIGHT} className="max-w-full">
        {/* baseline */}
        <line
          x1={M.left}
          x2={M.left + plotW}
          y1={M.top + plotH}
          y2={M.top + plotH}
          className="stroke-border"
          strokeWidth={1}
        />
        {buckets.map((b, i) => {
          const x = M.left + (i / buckets.length) * plotW + gap / 2;
          const y = yOf(b.count);
          const label = `${b.label} attempt${b.label === '1' ? '' : 's'}: ${b.count} (${fmtPct(b.count, solvedCount)})`;
          return (
            <g key={b.label}>
              <rect
                x={x}
                y={y}
                width={Math.max(0, barW)}
                height={Math.max(0, M.top + plotH - y)}
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
              <text
                x={x + barW / 2}
                y={M.top + plotH + 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
                aria-hidden="true"
              >
                {b.label}
              </text>
            </g>
          );
        })}
        <text
          x={M.left + plotW / 2}
          y={HEIGHT - 2}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px]"
          aria-hidden="true"
        >
          Submissions until first correct
        </text>
      </svg>

      <ChartDataTable
        caption={`Attempts until first correct, across ${solvedCount} solved ${unitPlural} problem pairs.`}
        headers={['Attempts', 'Count', 'Percent']}
        rows={buckets.map((b) => [b.label, b.count, fmtPct(b.count, solvedCount)])}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
