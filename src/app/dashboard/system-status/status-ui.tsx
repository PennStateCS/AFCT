'use client';

/**
 * Shared building blocks for the System Status tabs: the per-tab query hook and the
 * presentational primitives every tab composes.
 *
 * Two neighbours hold the rest: `status-format.ts` for the pure display formatters, and
 * `use-trends.ts` for the localStorage-backed trend history.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { Badge } from '@/components/ui/badge';
import { DataTableLoading } from '@/components/ui/data-table-status';

/**
 * Shared query for a status tab: fetches its endpoint only while the tab is the
 * active one (`enabled`), serves warm within 15s (`staleTime`) so switching back
 * is instant, and polls on the same 15s cadence when auto-refresh is on.
 */
export function useStatusQuery<T>(opts: {
  queryKey: readonly unknown[];
  path: string;
  active: boolean;
  autoRefresh: boolean;
}) {
  // `path` is derived from the same inputs as the caller's `queryKey`, so it
  // needn't (and can't cleanly) be part of the key inside this generic wrapper.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return useQuery<T>({
    queryKey: [...opts.queryKey],
    queryFn: () => fetchJson<T>(opts.path),
    enabled: opts.active,
    staleTime: 15_000,
    refetchInterval: opts.active && opts.autoRefresh ? 15_000 : false,
  });
}

/** Copy to the clipboard, falling back to a hidden textarea on older browsers. */
export const copy = async (text?: string | null) => {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
};

/* -------------------- primitives -------------------- */
export const Skel = ({ w = 'w-24' }: { w?: string }) => (
  <div className={`h-4 ${w} bg-muted animate-pulse rounded`} />
);

/**
 * The same loading treatment the data tables use, rather than a second one.
 *
 * This was flat text with no animation, so switching to a tab that had to fetch looked like a
 * page that had stopped. `DataTableLoading` is not table-specific (the card view already reuses
 * it) and it brings the shared spinner and the `role="status"` announcement with it, which the
 * text version never had.
 */
export const Loading = ({ label = 'Loading…' }: { label?: string }) => (
  <DataTableLoading message={label} className="py-8 text-sm" />
);

export const Meter = ({ pct, label }: { pct?: number; label: string }) => {
  const v = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  return (
    <div
      className="bg-muted h-2 w-full overflow-hidden rounded"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-valuetext={`${v}%`}
    >
      <div className="bg-primary h-full" style={{ width: `${v}%` }} />
    </div>
  );
};

export const Stat = ({
  label,
  value,
  onCopy,
  copyAriaLabel,
}: {
  label: string;
  value: React.ReactNode;
  onCopy?: () => void;
  copyAriaLabel?: string;
}) => (
  <div className="flex items-start justify-between gap-4">
    <div className="text-muted-foreground text-sm">{label}</div>
    <div className="text-right text-sm break-words">
      {value}
      {onCopy ? (
        <button
          type="button"
          className="text-muted-foreground ml-2 text-xs underline hover:opacity-80"
          onClick={onCopy}
          aria-label={copyAriaLabel ?? `Copy ${label}`}
        >
          Copy
        </button>
      ) : null}
    </div>
  </div>
);

/** A titled section for the in-card tab content (replaces per-panel Cards). */
export const Section = ({
  title,
  action,
  children,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

export const TrendBadge = ({ delta }: { delta: number }) => {
  const up = delta > 0;
  const flat = Math.abs(delta) < 0.1;
  const variant = flat ? 'neutral' : up ? 'success' : 'danger';
  const arrow = flat ? '•' : up ? '▲' : '▼';
  const direction = flat ? 'no change' : up ? 'up' : 'down';
  const mag = Math.abs(delta) < 1 ? delta.toFixed(1) : Math.round(delta);
  return (
    <Badge variant={variant} className="ml-2 text-xs">
      <span aria-hidden="true">{arrow}</span> {mag}
      <span className="sr-only"> ({direction})</span>
    </Badge>
  );
};

export const Sparkline = ({
  points,
  height = 30,
  width = 100,
  label,
}: {
  points: number[];
  height?: number;
  width?: number;
  label?: string;
}) => {
  if (!points || points.length < 2) return <span className="text-muted-foreground text-xs">—</span>;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const normalized = points.map((p) => (p - min) / range);
  const step = width / (points.length - 1);
  const d = normalized
    .map((n, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${height - n * height}`)
    .join(' ');
  const trend = (points[points.length - 1] ?? 0) - (points[0] ?? 0);
  const trendColor =
    trend > 0
      ? 'var(--color-status-danger-solid)'
      : trend < 0
        ? 'var(--color-status-success-solid)'
        : 'var(--color-status-neutral-solid)';
  const trendDir = trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'flat';

  return (
    <div className="flex flex-col gap-1">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label ? `${label}: ` : ''}trend ${trendDir}`}
        className="stroke-current text-primary"
        strokeWidth={1.5}
        fill="none"
      >
        <path d={d} strokeLinecap="round" strokeLinejoin="round" />
        <circle
          cx={width}
          cy={height - (normalized[normalized.length - 1] ?? 0) * height}
          r={2}
          style={{ fill: trendColor }}
        />
      </svg>
      {label && <span className="text-muted-foreground text-xs">{label}</span>}
    </div>
  );
};
