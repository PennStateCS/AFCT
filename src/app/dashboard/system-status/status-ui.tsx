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
import { cn } from '@/lib/utils';

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

/**
 * Two columns of `Stat` rows on anything but a phone.
 *
 * `Stat` puts its label and value at opposite ends of whatever box it is given, which is why
 * its callers cap the width: across a 1400px workspace the value ends up an inch from the
 * screen edge and a long way from the label it belongs to. A tall single column has the
 * opposite problem, so the tabs that hold a dozen readings pair them up instead. The cap
 * still belongs to the caller, through `className`: how wide these should be depends on what
 * is in them.
 */
export const StatGrid = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <div className={cn('grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2', className)}>{children}</div>
);

/**
 * One content measure for every status section, on every tab.
 *
 * This started as four named widths (compact / readable / standard / wide) on the theory
 * that seven short Docker readings and a diagnostic table want different room. In the
 * browser that produced two cards of different widths stacked on the Docker tab, and a
 * right edge that jumped between 768, 1024 and 1152 as you moved through the eight tabs,
 * which reads as an accident rather than as a decision.
 *
 * So: one measure. `StatGrid` already keeps a reading beside its label, and the tables
 * here are short operational lists, so nothing on these pages actually needed the extra
 * room it was being given. Add a second width only with a case that survives looking at
 * it next to its neighbours.
 */
export const STATUS_STANDARD = 'w-full max-w-5xl';

/** A stable id from the visible title, so the heading and its section stay associated. */
export function statusSectionId(title: string) {
  return `status-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/**
 * One titled group of status information.
 *
 * The panel treatment, padding and internal rhythm are deliberately the same numbers
 * System Settings uses (see `SETTINGS_BOX_CLASS`): a professor moving between the two
 * admin pages should not have to learn a second visual language. Written out here rather
 * than imported across page directories, because these are two pages that agree today,
 * not one shared component.
 *
 * `boxed={false}` for content that brings its own surface. A DataTable already draws a
 * bordered shell and a card around a card is noise, worst of all in the high-contrast
 * theme where both borders are solid black.
 */
export const StatusSection = ({
  title,
  titleText,
  description,
  action,
  className,
  boxed = true,
  children,
}: {
  title: React.ReactNode;
  /**
   * The section's name, when `title` is markup rather than a string.
   *
   * Files builds its headings out of an icon, a label and a count badge, and without this
   * such a section would quietly become an unnamed landmark: a region a screen reader
   * announces with no idea what it contains.
   */
  titleText?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** The width this section's content wants. Defaults to {@link STATUS_STANDARD}. */
  className?: string;
  boxed?: boolean;
  children: React.ReactNode;
}) => {
  const name = titleText ?? (typeof title === 'string' ? title : undefined);
  const id = name ? statusSectionId(name) : undefined;

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h2 id={id} className="flex items-center gap-2 text-base font-semibold">
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground max-w-3xl text-sm">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );

  if (!boxed) {
    return (
      <section aria-labelledby={id} className={cn('space-y-3', className ?? STATUS_STANDARD)}>
        {header}
        {children}
      </section>
    );
  }

  return (
    <section aria-labelledby={id} className={className ?? STATUS_STANDARD}>
      <div className="bg-card space-y-4 rounded-lg border px-5 py-4 shadow-xs">
        {header}
        {children}
      </div>
    </section>
  );
};

/**
 * A labelled group inside a section: "Details", "Last migration", "Error rates".
 *
 * Seven of these were hand-built as `text-muted-foreground mb-2 text-sm font-semibold`,
 * which put a subgroup heading in the SAME colour as the `Stat` labels under it and left
 * weight as the only thing telling them apart. Foreground, so a subgroup sits clearly
 * between the section title above it and the readings below.
 */
export const StatusSubsection = ({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <div className={cn('space-y-2', className)}>
    <h3 className="text-foreground text-sm font-semibold">{title}</h3>
    {children}
  </div>
);

/**
 * A small inset inside a panel: a sparkline's plot area, a path list.
 *
 * `bg-muted` and no shadow, so it reads as a recess in the card rather than a second card
 * on top of it. A bare border-inside-a-border is what this replaces, and it is worst in
 * high contrast where both are solid black.
 */
export const StatusInset = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => <div className={cn('bg-muted rounded-md border p-3', className)}>{children}</div>;

/**
 * Which direction is the good one for a given reading.
 *
 * There is no general answer, which is the whole point: CPU climbing is bad, a database
 * that has stopped growing may be broken, and more sessions is neither. The badge used to
 * paint every rise green and every fall red, so a server running out of memory reported it
 * as a success. Callers say what the number means; `neutral` is the default because most
 * readings do not have a good direction.
 */
export type Polarity = 'up-bad' | 'up-good' | 'neutral';

export const TrendBadge = ({
  delta,
  polarity = 'neutral',
}: {
  delta: number;
  polarity?: Polarity;
}) => {
  const up = delta > 0;
  const flat = Math.abs(delta) < 0.1;
  const good = polarity === 'up-bad' ? !up : up;
  const variant = flat || polarity === 'neutral' ? 'neutral' : good ? 'success' : 'danger';
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

/**
 * A trend line whose end dot is coloured by direction, assuming a rise is the bad one.
 *
 * That assumption holds for every reading this draws today (CPU, memory, latency) and is
 * the reason it is written down: give this a series where climbing is fine and the dot
 * says the opposite. Take `Polarity` from `TrendBadge` if that day comes.
 */
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
        className="text-primary stroke-current"
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
