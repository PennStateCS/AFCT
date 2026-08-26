/**
 * Display formatters for the System Status tabs. Deliberately a plain module with no
 * React and no browser APIs, so it can be unit-tested directly and imported from either
 * side of the client boundary. Anything that touches the DOM (clipboard, localStorage)
 * belongs in `status-ui.tsx` or `use-trends.ts` instead.
 *
 * All of these take "we could not read this" as a normal input and render an em-free
 * placeholder rather than throwing or printing NaN.
 */

import { DASH } from '@/lib/format-bytes';

export { DASH };

export const formatUptime = (secs?: number | null) => {
  if (secs == null || Number.isNaN(Number(secs))) return DASH;
  const total = Math.floor(Number(secs));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
};

// One implementation, shared with the system-settings pages. They used to have their own,
// which rounded differently and carried a unit this one lacked.
export { formatBytes } from '@/lib/format-bytes';
export { formatBytes as formatDbSize } from '@/lib/format-bytes';

export const formatMs = (ms?: number | null) =>
  typeof ms === 'number' && Number.isFinite(ms) ? `${ms} ms` : DASH;

/**
 * How worried to be about the summary probe's round trip.
 *
 * The badge beside the page heading used to be amber whenever a latency existed at all, so a
 * healthy 20ms server wore the same warning as a struggling one and the colour stopped
 * meaning anything. These two lines are judgement, not measurement: the probe is AFCT asking
 * its own database a handful of questions, so half a second is already slower than that
 * should ever take, and two seconds is a page that feels broken. They are named rather than
 * written inline so a site that finds them wrong has one place to change.
 */
export const LATENCY_WARNING_MS = 500;
export const LATENCY_DANGER_MS = 2000;

export const latencyTone = (ms?: number | null): 'neutral' | 'warning' | 'danger' => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'neutral';
  if (ms >= LATENCY_DANGER_MS) return 'danger';
  if (ms >= LATENCY_WARNING_MS) return 'warning';
  return 'neutral';
};

export const formatRate = (pct?: number | null) =>
  typeof pct === 'number' && Number.isFinite(pct) ? `${pct.toFixed(1)}%` : DASH;

/** Trims a Postgres version banner down to the engine and word size. */
export const formatDbVersion = (v?: string | null) => {
  if (!v) return DASH;
  const pg = v.match(/(PostgreSQL\s+\d+(?:\.\d+)?)/i)?.[1];
  const bits = v.match(/(\d+-bit)/i)?.[1];
  if (pg) return [pg, bits].filter(Boolean).join(' ');
  return v.split(',')[0]?.trim() || v;
};

export const toTitleCase = (s?: string | null) =>
  s ? s.replace(/\w\S*/g, (w) => (w[0] ?? '').toUpperCase() + w.slice(1).toLowerCase()) : DASH;

/**
 * Rounded "in 12 minutes" / "12 minutes ago" for a moment relative to `from`. Callers
 * pass the server's clock as `from` (not `Date.now()`), so a client whose time is off
 * does not render a live deadline as already passed.
 */
export const formatRelative = (at: number, from: number) => {
  const deltaMs = at - from;
  const future = deltaMs >= 0;
  const minutes = Math.round(Math.abs(deltaMs) / 60_000);
  if (minutes < 1) return future ? 'in under a minute' : 'just now';
  const hours = Math.floor(minutes / 60);
  const span =
    hours >= 1
      ? `${hours} hour${hours === 1 ? '' : 's'}${minutes % 60 ? ` ${minutes % 60} min` : ''}`
      : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return future ? `in ${span}` : `${span} ago`;
};
