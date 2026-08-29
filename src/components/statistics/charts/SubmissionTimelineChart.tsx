'use client';

import { useMemo } from 'react';
import type { TimelinePoint } from '@/lib/assignment-statistics';
import { ChartDataTable, ChartTooltip, useChartTooltip, useMeasuredWidth } from './chart-utils';

type Props = {
  timeline: TimelinePoint[];
  /**
   * The deadlines to mark, each an ISO instant and what to call it.
   *
   * One on an assignment page, one per assignment on a course page. A list rather than a
   * single date because a term has a dozen, and a chart that could only draw the first would
   * be showing the term's rhythm with most of its beats missing.
   */
  markers: { id: string; label: string; at: string }[];
  /** Course timezone, so a marker lands on the same local day as the buckets. */
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

export function SubmissionTimelineChart({ timeline, markers, timeZone, unitPlural }: Props) {
  const [ref, width] = useMeasuredWidth(640);
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();

  // Which local day each marker falls on, and what to call it there. Several deadlines can
  // land on one day, which is a real thing a course does in the last week of term.
  const markedDays = useMemo(() => {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const byDay = new Map<string, string[]>();
    for (const marker of markers) {
      const key = day.format(new Date(marker.at));
      byDay.set(key, [...(byDay.get(key) ?? []), marker.label]);
    }
    return byDay;
  }, [markers, timeZone]);

  const labelFor = (date: string) => markedDays.get(date)?.join(', ') ?? '';

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
          const due = labelFor(p.date);
          const label = `${shortDate(p.date)}: ${p.count} submission${p.count === 1 ? '' : 's'}${
            due ? `, due: ${due}` : ''
          }`;
          return (
            <g key={p.date}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(0, M.top + plotH - y)}
                rx={1.5}
                className="fill-chart-1 outline-none focus-visible:[outline:2px_solid_var(--color-ring)]"
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

        {/*
          Deadline markers. The word "Due" is only written when there are few enough of them
          to read: a term with a dozen assignments would otherwise be a row of overlapping
          labels, and the lines alone still show the shape. Which deadline is which is in the
          tooltip and the table.
        */}
        {timeline.map((p, i) =>
          markedDays.has(p.date) ? (
            <g key={`due-${p.date}`} aria-hidden="true">
              <line
                x1={centerX(i)}
                x2={centerX(i)}
                y1={M.top}
                y2={M.top + plotH}
                className="stroke-border"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              {markedDays.size <= 3 && (
                <text
                  x={centerX(i)}
                  y={M.top - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px] font-medium"
                >
                  Due
                </text>
              )}
            </g>
          ) : null,
        )}
      </svg>

      {/*
        The deadlines are a column, not just lines on the drawing.
        The markers are inside `aria-hidden` groups, so a reader could see every day's count
        and still not know which day the work was due, which is the whole comparison this
        chart exists to support.
      */}
      <ChartDataTable
        caption={`Submissions per day for ${unitPlural}, with each deadline marked.`}
        headers={['Date', 'Submissions', 'Due']}
        rows={timeline.map((p) => [p.date, p.count, labelFor(p.date)])}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
