'use client';

/**
 * The status dashboard's trend history: a rolling window of summary samples kept in
 * localStorage so the arrows next to each tile survive a reload.
 *
 * This is a browser-only store rather than a server-side time series on purpose. It is
 * a convenience for the administrator looking at the page right now, not monitoring: the
 * history is per-browser, and clearing site data resets it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

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

  // Persist each new sample to history as a side effect, never during render.
  // Dedupe by timestamp so a repeated effect run (e.g. StrictMode's double
  // invoke) can't append the same point twice, and any legacy dupes collapse.
  useEffect(() => {
    if (!sample) return;
    const cutoff = sample.ts - keepHours * 3600_000;
    const byTs = new Map<number, HistoryPoint>();
    for (const p of readHistory()) {
      if (p.ts >= cutoff) byTs.set(p.ts, p);
    }
    byTs.set(sample.ts, sample);
    writeHistory([...byTs.values()]);
  }, [sample, keepHours]);

  const trends = useMemo(() => {
    const now = Date.now();
    const hist = readHistory();
    // Fold in the current sample so the trend reflects it before the effect commits.
    const source = sample ? [...hist.filter((p) => p.ts !== sample.ts), sample] : hist;

    const windowHist = source.filter((p) => now - p.ts <= windowHours * 3600_000);
    const delta = (a?: number | null, b?: number | null) =>
      typeof a === 'number' && typeof b === 'number' ? b - a : 0;
    if (windowHist.length < 2) {
      return { cpu: 0, mem: 0, dbSize: 0, dbTables: 0, sessions: 0, latency: 0 };
    }
    const first = windowHist[0];
    const last = windowHist[windowHist.length - 1];
    if (!first || !last) {
      return { cpu: 0, mem: 0, dbSize: 0, dbTables: 0, sessions: 0, latency: 0 };
    }
    return {
      cpu: delta(first.cpuPct, last.cpuPct),
      mem: delta(first.memPct, last.memPct),
      dbSize: delta(first.dbSizeMB, last.dbSizeMB),
      dbTables: delta(first.dbTables ?? null, last.dbTables ?? null),
      sessions: delta(first.sessions24h, last.sessions24h),
      latency: delta(first.latencyMs, last.latencyMs),
    };
  }, [sample, windowHours]);

  return { windowHours, setHours, trends };
}
