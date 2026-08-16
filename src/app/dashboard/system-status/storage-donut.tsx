'use client';

import React from 'react';

/**
 * A donut chart, drawn by hand.
 *
 * No charting library: the page is one small proportion chart away from pulling in a dependency
 * that would ship on every route for this. An SVG circle whose circumference is exactly 100
 * makes each slice's `stroke-dasharray` its percentage, which is the whole of the maths.
 *
 * The chart is `aria-hidden` on purpose. Colour cannot carry meaning on its own, so the legend
 * beside it is the real content, and every number in the picture is written there in words. A
 * screen reader that read both would hear everything twice.
 */

export type DonutSlice = {
  key: string;
  label: string;
  bytes: number;
  /** A Tailwind stroke class, so slices follow the theme in both light and dark. */
  stroke: string;
};

/** Percentage of the whole, kept above zero for anything non-empty so a sliver still draws. */
export const shareOf = (bytes: number, total: number) => (total > 0 ? (bytes / total) * 100 : 0);

export function StorageDonut({
  slices,
  total,
  centreValue,
  centreLabel,
}: {
  slices: DonutSlice[];
  total: number;
  /** The one figure worth putting in the hole, e.g. how much is free. */
  centreValue: string;
  centreLabel: string;
}) {
  // A circle of radius 15.915 has a circumference of 100, so a slice's dash length is its
  // percentage with no conversion in between.
  const RADIUS = 15.915;

  // Each slice starts where the ones before it end. Summed per slice rather than carried in a
  // variable, because a handful of slices makes the cost irrelevant and nothing is reassigned
  // while rendering.
  const present = slices.filter((s) => s.bytes > 0);
  const drawn = present.map((s, i) => ({
    ...s,
    // Anything present gets at least a hairline: a slice rounded to nothing looks like a
    // category that is not there at all, which is a different fact.
    length: Math.max(shareOf(s.bytes, total), 0.4),
    offset: present.slice(0, i).reduce((sum, prev) => sum + shareOf(prev.bytes, total), 0),
  }));

  return (
    <div className="relative size-32 shrink-0">
      <svg viewBox="0 0 42 42" className="size-full -rotate-90" aria-hidden>
        <circle cx="21" cy="21" r={RADIUS} fill="none" className="stroke-muted" strokeWidth="5" />
        {drawn.map((s) => (
          <circle
            key={s.key}
            cx="21"
            cy="21"
            r={RADIUS}
            fill="none"
            className={s.stroke}
            strokeWidth="5"
            strokeDasharray={`${s.length} ${100 - s.length}`}
            strokeDashoffset={-s.offset}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-base font-semibold tabular-nums">{centreValue}</span>
        <span className="text-muted-foreground text-xs">{centreLabel}</span>
      </div>
    </div>
  );
}

/**
 * The written version of the chart, and the part assistive technology reads.
 *
 * Each entry is two lines: the name on its own, the numbers underneath. Putting them on one
 * line and letting the name shorten to fit turned "Profile photos" into "Profile ph", which is
 * the one thing a legend has to get right. A name is never abbreviated here; if the numbers
 * cannot fit beside it they wrap instead.
 */
export function DonutLegend({
  slices,
  total,
  note,
}: {
  slices: Array<DonutSlice & { detail?: React.ReactNode }>;
  total: number;
  note?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 flex-1 space-y-2">
      <ul className="space-y-2">
        {slices.map((s) => {
          const pct = shareOf(s.bytes, total);
          return (
            <li key={s.key} className="flex items-start gap-2 text-sm">
              <span
                className={`${s.stroke.replace('stroke-', 'bg-')} mt-1.5 size-2 shrink-0 rounded-sm`}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block leading-tight">{s.label}</span>
                <span className="text-muted-foreground block text-xs tabular-nums">
                  {s.detail}
                  {s.detail ? ' · ' : ''}
                  {/* Round to nothing and a real slice reads as absent, so anything present that
                      rounds below a percent says so instead of saying zero. */}
                  {pct > 0 && pct < 1 ? '<1' : Math.round(pct)}%
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {note && <p className="text-muted-foreground text-xs">{note}</p>}
    </div>
  );
}
