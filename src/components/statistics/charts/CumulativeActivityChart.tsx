'use client';

import { useMemo } from 'react';
import { runningTotals, type TimelinePoint } from '@/lib/assignment-statistics';
import { ChartDataTable, ChartTooltip, useChartTooltip, useMeasuredWidth } from './chart-utils';

type Props = {
  timeline: TimelinePoint[];
  /** The deadlines to mark, each an ISO instant and what to call it. */
  markers: { id: string; label: string; at: string }[];
  /** Course timezone, so a marker lands on the same local day as the buckets. */
  timeZone: string;
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

const HEIGHT = 260;
const M = { top: 16, right: 12, bottom: 34, left: 44 };

/** "2026-08-03" -> "8/3" */
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** A whole-number y step giving roughly five ticks. */
function niceStep(max: number): number {
  if (max <= 5) return 1;
  const rough = max / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (pow * m >= rough) return pow * m;
  }
  return pow * 10;
}

/**
 * Every submission the course has seen, adding up, with each deadline marked.
 *
 * It counts ATTEMPTS, not work finished: a student going ten rounds with the autograder lifts
 * this line as much as ten students each handing in once. That is deliberate. The question it
 * answers is when the class is working, and somebody grinding at midnight is working.
 *
 * The shape is the finding, and the deadlines are what make it readable. A riser that begins
 * three days before a due date is a class pacing itself; one that goes vertical in the last
 * few hours is a class doing it all at once. A deadline with no riser under it is an
 * assignment nobody worked toward.
 */
export function CumulativeActivityChart({ timeline, markers, timeZone, unitPlural }: Props) {
  const [ref, width] = useMeasuredWidth(640);
  const { state, showAtEvent, showAtElement, hide } = useChartTooltip();

  const points = useMemo(() => runningTotals(timeline), [timeline]);

  // Which local day each deadline falls on. Several can share one day, which is what the last
  // week of term looks like.
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
  const dueLabel = (date: string) => markedDays.get(date)?.join(', ') ?? '';

  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const total = points.length > 0 ? points[points.length - 1]!.total : 0;
  const yMax = Math.max(1, total);
  const step = niceStep(yMax);
  const ticks = Array.from({ length: Math.floor(yMax / step) + 1 }, (_, i) => i * step);
  const yOf = (value: number) => M.top + plotH * (1 - value / yMax);
  const slot = points.length > 0 ? plotW / points.length : plotW;
  const centerX = (i: number) => M.left + i * slot + slot / 2;

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${centerX(i)} ${yOf(p.total)}`)
    .join(' ');
  // The area under it, so the shape reads at a glance rather than as a thin thread.
  const area =
    points.length > 0
      ? `${line} L ${centerX(points.length - 1)} ${M.top + plotH} L ${centerX(0)} ${M.top + plotH} Z`
      : '';

  const labelStep = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div
      ref={ref}
      className="w-full"
      role="group"
      aria-label={`Submissions by ${unitPlural} adding up over the course, with each deadline marked.`}
    >
      <svg width={width} height={HEIGHT} className="max-w-full">
        {ticks.map((t) => (
          <g key={t}>
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
              aria-hidden="true"
            >
              {t}
            </text>
          </g>
        ))}

        {/* Deadlines. Unlabelled on purpose: a term has a dozen and the labels would overlap
            into a smear. Which is which is in the tooltip and the table. */}
        {points.map((p, i) =>
          markedDays.has(p.date) ? (
            <line
              key={`due-${p.date}`}
              x1={centerX(i)}
              x2={centerX(i)}
              y1={M.top}
              y2={M.top + plotH}
              className="stroke-border"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              aria-hidden="true"
            />
          ) : null,
        )}

        <path d={area} className="fill-chart-1/15" aria-hidden="true" />
        <path
          d={line}
          fill="none"
          className="stroke-chart-1"
          strokeWidth={2}
          strokeLinejoin="round"
          aria-hidden="true"
        />

        {points.map((p, i) => {
          const due = dueLabel(p.date);
          const label =
            `${shortDate(p.date)}: ${p.count} submission${p.count === 1 ? '' : 's'}, ` +
            `${p.total} in total${due ? `, due: ${due}` : ''}`;
          return (
            <g key={p.date}>
              {/* An invisible column per day: the line itself cannot take focus, and a
                  keyboard reader still has to be able to walk the term. */}
              <rect
                x={M.left + i * slot}
                y={M.top}
                width={Math.max(1, slot)}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={label}
                className="outline-none focus-visible:[outline:2px_solid_var(--color-ring)] focus-visible:[outline-offset:-2px]"
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
      </svg>

      <ChartDataTable
        caption={`Submissions by ${unitPlural} per day and adding up, with each deadline marked.`}
        headers={['Date', 'Submissions', 'Running total', 'Due']}
        rows={points.map((p) => [p.date, p.count, p.total, dueLabel(p.date)])}
      />
      <ChartTooltip state={state} />
    </div>
  );
}
