'use client';

import { useMemo } from 'react';
import type { TimelinePoint } from '@/lib/assignment-statistics';
import { ChartDataTable, ChartTooltip, useChartTooltip, useMeasuredWidth } from './chart-utils';

type Props = {
  timeline: TimelinePoint[];
  /** Assignment base due date (ISO); a marker is drawn on that day. */
  dueDate: string;
  /** Course timezone, so the due-date marker lands on the same local day as the buckets. */
  timeZone: string;
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

const HEIGHT = 240;
const M = { top: 16, right: 12, bottom: 34, left: 34 };

/** "2026-08-03" -> "8/3" */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function SubmissionTimelineChart({ timeline, dueDate, timeZone, unitPlural }: Props) {
  const [ref, width] = useMeasuredWidth(640);
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();

  const dueDay = useMemo(
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(dueDate)),
    [dueDate, timeZone],
  );
  const dueIndex = timeline.findIndex((p) => p.date === dueDay);

  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const yMax = Math.max(1, ...timeline.map((p) => p.count));
  const yOf = (count: number) => M.top + plotH * (1 - count / yMax);
  const slot = timeline.length > 0 ? plotW / timeline.length : plotW;
  const gap = slot * 0.2;
  const barW = Math.max(1, slot - gap);
  const centerX = (i: number) => M.left + i * slot + slot / 2;

  // Thin the x labels so they never overlap.
  const labelStep = Math.max(1, Math.ceil(timeline.length / 8));

  return (
    <div
      ref={ref}
      className="w-full"
      role="group"
      aria-label={`Submissions per day for ${unitPlural}, from the first submission to the last.`}
    >
      <svg width={width} height={HEIGHT} className="max-w-full">
        <line
          x1={M.left}
          x2={M.left + plotW}
          y1={M.top + plotH}
          y2={M.top + plotH}
          className="stroke-border"
          strokeWidth={1}
        />

        {timeline.map((p, i) => {
          const x = M.left + i * slot + gap / 2;
          const y = yOf(p.count);
          const label = `${shortDate(p.date)}: ${p.count} submission${p.count === 1 ? '' : 's'}`;
          return (
            <g key={p.date}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(0, M.top + plotH - y)}
                rx={1.5}
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
              {i % labelStep === 0 && (
                <text
                  x={centerX(i)}
                  y={M.top + plotH + 14}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                  aria-hidden="true"
                >
                  {shortDate(p.date)}
                </text>
              )}
            </g>
          );
        })}

        {/* Due-date marker */}
        {dueIndex >= 0 && (
          <g aria-hidden="true">
            <line
              x1={centerX(dueIndex)}
              x2={centerX(dueIndex)}
              y1={M.top}
              y2={M.top + plotH}
              className="stroke-tertiary"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text
              x={centerX(dueIndex)}
              y={M.top - 4}
              textAnchor="middle"
              className="fill-tertiary text-[10px] font-medium"
            >
              Due
            </text>
          </g>
        )}
      </svg>

      <ChartDataTable
        caption={`Submissions per day for ${unitPlural}.`}
        headers={['Date', 'Submissions']}
        rows={timeline.map((p) => [p.date, p.count])}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
