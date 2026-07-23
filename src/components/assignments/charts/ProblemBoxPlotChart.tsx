'use client';

import type { ProblemBoxPlot } from '@/lib/assignment-statistics';
import {
  ChartDataTable,
  ChartTooltip,
  fmt1,
  useChartTooltip,
  useMeasuredWidth,
} from './chart-utils';

type Props = {
  problems: ProblemBoxPlot[];
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

const ROW_H = 46;
const AXIS_H = 26;
const BOX_H = 18;
const INSET = 6; // keep 0% and 100% marks off the very edge

function statsText(p: ProblemBoxPlot, unitPlural: string): string {
  if (!p.boxplot) return `${p.title}: no graded ${unitPlural}.`;
  const b = p.boxplot;
  return (
    `${p.title}. Median ${fmt1(b.median)}%, mean ${fmt1(b.mean)}%. ` +
    `Middle 50% from ${fmt1(b.q1)}% to ${fmt1(b.q3)}%. ` +
    `Whiskers ${fmt1(b.whiskerLow)}% to ${fmt1(b.whiskerHigh)}%. ` +
    `${p.gradedCount} graded, ${p.ungradedCount} missing or ungraded.`
  );
}

function Tooltip({ p, unitPlural }: { p: ProblemBoxPlot; unitPlural: string }) {
  const b = p.boxplot;
  return (
    <div className="space-y-0.5">
      <div className="font-medium">{p.title}</div>
      {b ? (
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
          <dt>Median</dt>
          <dd className="text-right tabular-nums">{fmt1(b.median)}%</dd>
          <dt>Mean</dt>
          <dd className="text-right tabular-nums">{fmt1(b.mean)}%</dd>
          <dt>Middle 50%</dt>
          <dd className="text-right tabular-nums">
            {fmt1(b.q1)}-{fmt1(b.q3)}%
          </dd>
          <dt>Whiskers</dt>
          <dd className="text-right tabular-nums">
            {fmt1(b.whiskerLow)}-{fmt1(b.whiskerHigh)}%
          </dd>
          <dt>Graded</dt>
          <dd className="text-right tabular-nums">{p.gradedCount}</dd>
          <dt>Missing</dt>
          <dd className="text-right tabular-nums">{p.ungradedCount}</dd>
        </dl>
      ) : (
        <div className="text-muted-foreground">No graded {unitPlural}.</div>
      )}
    </div>
  );
}

export function ProblemBoxPlotChart({ problems, unitPlural }: Props) {
  const [ref, width] = useMeasuredWidth(520);
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();

  const plotW = Math.max(0, width);
  const innerW = Math.max(0, plotW - 2 * INSET);
  const xOf = (v: number) => INSET + (Math.max(0, Math.min(100, v)) / 100) * innerW;
  const svgH = problems.length * ROW_H + AXIS_H;
  const gridTicks = [0, 25, 50, 75, 100];

  return (
    <div
      className="w-full"
      role="group"
      aria-label={`Box plots of per-problem scores across the graded ${unitPlural}.`}
    >
      <div className="flex w-full gap-2">
        {/* Problem labels: HTML so long names truncate cleanly; full name stays in the
            title attribute and the focusable plot's accessible name. */}
        <div className="w-24 shrink-0 sm:w-36">
          {problems.map((p) => (
            <div
              key={p.id}
              className="text-foreground flex items-center truncate text-xs"
              style={{ height: ROW_H }}
              title={p.title}
            >
              {p.title}
            </div>
          ))}
          <div style={{ height: AXIS_H }} />
        </div>

        <div ref={ref} className="min-w-0 flex-1">
          <svg width={plotW} height={svgH} className="max-w-full">
            {/* vertical gridlines across all rows */}
            {gridTicks.map((t) => (
              <line
                key={t}
                x1={xOf(t)}
                x2={xOf(t)}
                y1={0}
                y2={problems.length * ROW_H}
                className="stroke-border"
                strokeWidth={1}
              />
            ))}

            {problems.map((p, i) => {
              const cy = i * ROW_H + ROW_H / 2;
              const b = p.boxplot;
              if (!b) {
                return (
                  <text
                    key={p.id}
                    x={xOf(0)}
                    y={cy}
                    dominantBaseline="middle"
                    className="fill-muted-foreground text-[11px] italic"
                    aria-hidden="true"
                  >
                    No graded {unitPlural}
                  </text>
                );
              }
              return (
                <g key={p.id}>
                  {/* whisker line + caps */}
                  <line
                    x1={xOf(b.whiskerLow)}
                    x2={xOf(b.whiskerHigh)}
                    y1={cy}
                    y2={cy}
                    className="stroke-brand-teal"
                    strokeWidth={1.5}
                  />
                  <line
                    x1={xOf(b.whiskerLow)}
                    x2={xOf(b.whiskerLow)}
                    y1={cy - 6}
                    y2={cy + 6}
                    className="stroke-brand-teal"
                    strokeWidth={1.5}
                  />
                  <line
                    x1={xOf(b.whiskerHigh)}
                    x2={xOf(b.whiskerHigh)}
                    y1={cy - 6}
                    y2={cy + 6}
                    className="stroke-brand-teal"
                    strokeWidth={1.5}
                  />
                  {/* interquartile box */}
                  <rect
                    x={xOf(b.q1)}
                    y={cy - BOX_H / 2}
                    width={Math.max(1, xOf(b.q3) - xOf(b.q1))}
                    height={BOX_H}
                    rx={2}
                    className="fill-brand-teal/25 stroke-brand-teal"
                    strokeWidth={1.5}
                  />
                  {/* median */}
                  <line
                    x1={xOf(b.median)}
                    x2={xOf(b.median)}
                    y1={cy - BOX_H / 2}
                    y2={cy + BOX_H / 2}
                    className="stroke-brand-teal"
                    strokeWidth={2.5}
                  />
                  {/* mean: a distinct diamond */}
                  <path
                    d={`M ${xOf(b.mean)} ${cy - 4} L ${xOf(b.mean) + 4} ${cy} L ${xOf(b.mean)} ${cy + 4} L ${xOf(b.mean) - 4} ${cy} Z`}
                    className="fill-primary stroke-card"
                    strokeWidth={1}
                  />
                  {/* outliers: hollow dots */}
                  {b.outliers.map((o, oi) => (
                    <circle
                      key={oi}
                      cx={xOf(o)}
                      cy={cy}
                      r={2.5}
                      className="fill-none stroke-muted-foreground"
                      strokeWidth={1.25}
                    />
                  ))}
                  {/* transparent hit area for hover/focus over the whole row */}
                  <rect
                    x={0}
                    y={i * ROW_H}
                    width={plotW}
                    height={ROW_H}
                    fill="transparent"
                    tabIndex={0}
                    role="img"
                    aria-label={statsText(p, unitPlural)}
                    className="outline-none focus-visible:[outline:2px_solid_var(--color-ring)] focus-visible:[outline-offset:-2px]"
                    onMouseEnter={(e) => showAtEvent(e, <Tooltip p={p} unitPlural={unitPlural} />)}
                    onMouseMove={(e) => showAtEvent(e, <Tooltip p={p} unitPlural={unitPlural} />)}
                    onMouseLeave={hide}
                    onFocus={(e) => showAtElement(e.currentTarget, <Tooltip p={p} unitPlural={unitPlural} />)}
                    onBlur={hide}
                  />
                </g>
              );
            })}

            {/* bottom axis (decorative) */}
            {gridTicks.map((t) => (
              <text
                key={t}
                x={xOf(t)}
                y={problems.length * ROW_H + 16}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
                aria-hidden="true"
              >
                {t}
              </text>
            ))}
          </svg>
        </div>
      </div>

      {/* legend */}
      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="border-brand-teal bg-brand-teal/25 inline-block h-3 w-4 rounded-sm border" />
          Middle 50%
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="12" aria-hidden="true">
            <path d="M 5 1 L 9 6 L 5 11 L 1 6 Z" className="fill-primary" />
          </svg>
          Mean
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="3" className="fill-none stroke-muted-foreground" strokeWidth={1.25} />
          </svg>
          Outlier
        </span>
        <span>Scale: 0-100%</span>
      </div>

      <ChartDataTable
        caption={`Per-problem score distribution across the graded ${unitPlural}.`}
        headers={['Problem', 'Median', 'Mean', 'Q1', 'Q3', 'Whisker low', 'Whisker high', 'Graded', 'Missing']}
        rows={problems.map((p) =>
          p.boxplot
            ? [
                p.title,
                `${fmt1(p.boxplot.median)}%`,
                `${fmt1(p.boxplot.mean)}%`,
                `${fmt1(p.boxplot.q1)}%`,
                `${fmt1(p.boxplot.q3)}%`,
                `${fmt1(p.boxplot.whiskerLow)}%`,
                `${fmt1(p.boxplot.whiskerHigh)}%`,
                p.gradedCount,
                p.ungradedCount,
              ]
            : [p.title, '-', '-', '-', '-', '-', '-', p.gradedCount, p.ungradedCount],
        )}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
