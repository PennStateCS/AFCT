/**
 * Display formatters for the System Status tabs. Deliberately a plain module with no
 * React and no browser APIs, so it can be unit-tested directly and imported from either
 * side of the client boundary. Anything that touches the DOM (clipboard, localStorage)
 * belongs in `status-ui.tsx` or `use-trends.ts` instead.
 *
 * All of these take "we could not read this" as a normal input and render an em-free
 * placeholder rather than throwing or printing NaN.
 */

const DASH = '—';

export const formatUptime = (secs?: number | null) => {
  if (secs == null || Number.isNaN(Number(secs))) return DASH;
  const total = Math.floor(Number(secs));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
};

export const formatBytes = (b?: number | null) => {
  if (b == null || Number.isNaN(Number(b))) return DASH;
  const bytes = Number(b);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  // Stopping at GB meant a terabyte volume read as "1006.85 GB", which is a number nobody
  // converts in their head. The Files tab reports disk sizes now, so this range is reachable.
  return `${(bytes / 1024 / 1024 / 1024 / 1024).toFixed(2)} TB`;
};

export const formatDbSize = formatBytes;

export const formatMs = (ms?: number | null) =>
  typeof ms === 'number' && Number.isFinite(ms) ? `${ms} ms` : DASH;

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
