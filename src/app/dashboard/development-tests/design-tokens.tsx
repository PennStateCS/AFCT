'use client';

import { Badge } from '@/components/ui/badge';

/**
 * A live reference for the app's semantic color tokens, rendered with the real Tailwind
 * token utilities so it always reflects the current theme. Toggle light/dark to compare.
 * Reach for these instead of hardcoded palette classes (bg-red-50, text-gray-500, ...);
 * the tokens carry their own dark-mode values and are the single place a colour changes
 * for a refresh or a future high-contrast theme.
 */

// A class name shown as copy-ready code.
function Cls({ children }: { children: string }) {
  return (
    <code className="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[11px]">
      {children}
    </code>
  );
}

const STATUS = [
  {
    variant: 'success',
    label: 'Success',
    text: 'text-status-success',
    bg: 'bg-status-success-bg',
    border: 'border-status-success-border',
    sample: 'Saved. Everything is up to date.',
    badge: 'Passed',
  },
  {
    variant: 'warning',
    label: 'Warning',
    text: 'text-status-warning',
    bg: 'bg-status-warning-bg',
    border: 'border-status-warning-border',
    sample: 'This group set has submissions and can no longer be changed.',
    badge: 'Pending',
  },
  {
    variant: 'danger',
    label: 'Danger',
    text: 'text-status-danger',
    bg: 'bg-status-danger-bg',
    border: 'border-status-danger-border',
    sample: 'Failed to load users. Please try again.',
    badge: 'Failed',
  },
  {
    variant: 'info',
    label: 'Info',
    text: 'text-status-info',
    bg: 'bg-status-info-bg',
    border: 'border-status-info-border',
    sample: 'An in-app upgrade needs a host-side update afterward.',
    badge: 'Info',
  },
] as const;

// Solid surface / accent tokens, each shown as a swatch with the utility that paints it.
const SURFACES = [
  { cls: 'bg-background', label: 'background' },
  { cls: 'bg-card', label: 'card' },
  { cls: 'bg-muted', label: 'muted' },
  { cls: 'bg-accent', label: 'accent' },
  { cls: 'bg-primary', label: 'primary' },
  { cls: 'bg-secondary', label: 'secondary' },
  { cls: 'bg-tertiary', label: 'tertiary' },
  { cls: 'bg-destructive', label: 'destructive' },
  { cls: 'bg-tab-active', label: 'tab-active' },
] as const;

export function DesignTokens() {
  return (
    <div className="space-y-8">
      {/* Status / feedback family */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Status / feedback</h3>
          <p className="text-muted-foreground text-sm">
            One family (<Cls>--status-*</Cls>) drives badges, inline status text, alert
            callouts, and toasts. Each state has a foreground, a soft <Cls>-bg</Cls>, and a{' '}
            <Cls>-border</Cls>.
          </p>
        </div>
        <div className="space-y-2.5">
          {STATUS.map((s) => (
            <div
              key={s.variant}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm ${s.border} ${s.bg} ${s.text}`}
            >
              <span>{s.sample}</span>
              <div className="flex items-center gap-2">
                <Badge variant={s.variant}>{s.badge}</Badge>
                <Cls>{`${s.text} ${s.bg} ${s.border}`}</Cls>
              </div>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground text-sm">
          Badges use the same values through <Cls>{'<Badge variant="success|warning|danger|info|neutral" />'}</Cls>.
        </p>
      </section>

      {/* Neutral + brand surfaces */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Surfaces &amp; accents</h3>
          <p className="text-muted-foreground text-sm">
            Structural and brand fills. Pair each with its foreground token where text sits
            on it (e.g. <Cls>bg-card</Cls> with <Cls>text-card-foreground</Cls>).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SURFACES.map((s) => (
            <div key={s.cls} className="border-border overflow-hidden rounded-md border">
              <div className={`h-12 ${s.cls}`} aria-hidden="true" />
              <div className="bg-card space-y-0.5 p-2">
                <div className="text-foreground text-xs font-medium">{s.label}</div>
                <Cls>{s.cls}</Cls>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Text + border tokens */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Text &amp; borders</h3>
          <p className="text-muted-foreground text-sm">
            The neutral tokens that replaced hardcoded grays.
          </p>
        </div>
        <div className="border-border bg-card space-y-2 rounded-md border p-3">
          <p className="text-foreground text-sm">
            Primary text — <Cls>text-foreground</Cls>
          </p>
          <p className="text-muted-foreground text-sm">
            Secondary / helper text — <Cls>text-muted-foreground</Cls>
          </p>
          <div className="text-muted-foreground flex items-center gap-2 pt-1 text-sm">
            <span className="border-border h-6 w-16 rounded border" aria-hidden="true" />
            <Cls>border-border</Cls>
          </div>
        </div>
      </section>
    </div>
  );
}
