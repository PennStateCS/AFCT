'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { Badge } from '@/components/ui/badge';

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

/* -------------------- formatters -------------------- */
export const formatUptime = (secs?: number | null) => {
  if (secs == null || Number.isNaN(Number(secs))) return '—';
  const total = Math.floor(Number(secs));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
};

export const formatBytes = (b?: number | null) => {
  if (b == null || Number.isNaN(Number(b))) return '—';
  const bytes = Number(b);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export const formatDbSize = formatBytes;

export const formatMs = (ms?: number | null) =>
  typeof ms === 'number' && Number.isFinite(ms) ? `${ms} ms` : '—';

export const formatRate = (pct?: number | null) =>
  typeof pct === 'number' && Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '—';

export const formatDbVersion = (v?: string | null) => {
  if (!v) return '—';
  const pg = v.match(/(PostgreSQL\s+\d+(?:\.\d+)?)/i)?.[1];
  const bits = v.match(/(\d+-bit)/i)?.[1];
  if (pg) return [pg, bits].filter(Boolean).join(' ');
  return v.split(',')[0]?.trim() || v;
};

export const toTitleCase = (s?: string | null) =>
  s ? s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) : '—';

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
      <div className="h-full bg-emerald-500" style={{ width: `${v}%` }} />
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

export const TrendBadge = ({ delta }: { delta: number }) => {
  const up = delta > 0;
  const flat = Math.abs(delta) < 0.1;
  const variant = flat ? 'neutral' : up ? 'success' : 'danger';
  const arrow = flat ? '•' : up ? '▲' : '▼';
  const mag = Math.abs(delta) < 1 ? delta.toFixed(1) : Math.round(delta);
  return (
    <Badge variant={variant} className="ml-2 text-xs">
      {arrow} {mag}
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
  const trend = points[points.length - 1] - points[0];
  const trendColor = trend > 0 ? '#ef4444' : trend < 0 ? '#22c55e' : '#94a3b8';

  return (
    <div className="flex flex-col gap-1">
      <svg
        width={width}
        height={height}
        className="stroke-current text-blue-500"
        strokeWidth={1.5}
        fill="none"
      >
        <path d={d} strokeLinecap="round" strokeLinejoin="round" />
        <circle
          cx={width}
          cy={height - normalized[normalized.length - 1] * height}
          r={2}
          fill={trendColor}
        />
      </svg>
      {label && <span className="text-muted-foreground text-xs">{label}</span>}
    </div>
  );
};

/* -------------------- trend history (localStorage) -------------------- */
export type HistoryPoint = {
  ts: number;
  cpuPct?: number;
  memPct?: number;
  dbSizeMB?: number;
  dbTables?: number | null;
  sessions24h?: number;
  latencyMs?: number;
};

const HIST_KEY = 'statusHistory:v2';

export const readHistory = (): HistoryPoint[] => {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryPoint[];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p?.ts === 'number') : [];
  } catch {
    return [];
  }
};

const writeHistory = (arr: HistoryPoint[]) => {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(arr));
  } catch {
    /* ignore quota / disabled storage */
  }
};

/**
 * Append the latest sample (keeping up to `keepHours`) and expose oldest→newest
 * deltas over a selectable window. Backed by localStorage so trends survive a
 * reload. Returns the window control so the header can drive it.
 */
export function useTrends(sample: HistoryPoint | null, keepHours = 24) {
  const [windowHours, setWindowHours] = useState(1);
  const setHours = useCallback((h: number) => setWindowHours(h), []);

  const trends = useMemo(() => {
    const hist = readHistory();
    const now = Date.now();

    let source = hist;
    if (sample) {
      const withNew = [...hist.filter((p) => now - p.ts <= keepHours * 3600_000), sample];
      writeHistory(withNew);
      source = withNew;
    }

    const windowHist = source.filter((p) => now - p.ts <= windowHours * 3600_000);
    const delta = (a?: number | null, b?: number | null) =>
      typeof a === 'number' && typeof b === 'number' ? b - a : 0;
    if (windowHist.length < 2) {
      return { cpu: 0, mem: 0, dbSize: 0, dbTables: 0, sessions: 0, latency: 0 };
    }
    const first = windowHist[0];
    const last = windowHist[windowHist.length - 1];
    return {
      cpu: delta(first.cpuPct, last.cpuPct),
      mem: delta(first.memPct, last.memPct),
      dbSize: delta(first.dbSizeMB, last.dbSizeMB),
      dbTables: delta(first.dbTables ?? null, last.dbTables ?? null),
      sessions: delta(first.sessions24h, last.sessions24h),
      latency: delta(first.latencyMs, last.latencyMs),
    };
  }, [sample, windowHours, keepHours]);

  return { windowHours, setHours, trends };
}
