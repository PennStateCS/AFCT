'use client';

import { BookOpen, Check, FileCheck, LayoutDashboard } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SelectField from '@/components/ui/SelectField';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

/**
 * A live reference for the app's semantic design tokens, rendered with the real Tailwind
 * token utilities and the real shared components so it always reflects the current theme.
 * Switch between Light, Dark and High contrast in the navbar to compare: nothing on this
 * page names a theme, so every swatch below simply follows whichever is active. Nothing here is a hardcoded hex or a lookalike control:
 * when globals.css changes, this page changes with it, which is the only way it stays
 * honest. Reach for these tokens instead of palette classes (bg-red-50, text-gray-500);
 * they carry their own dark-mode values and are the single place a colour changes for a
 * refresh or a future high-contrast theme.
 */

// A class name shown as copy-ready code. text-xs rather than text-2xs: this is a
// developer reference and the class names are the payload, not an annotation.
function Cls({ children }: { children: string }) {
  return (
    <code className="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-xs">
      {children}
    </code>
  );
}

/** One titled block of the reference. h3 under the page's "Design Tokens" h2. */
function TokenSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3" aria-labelledby={id}>
      <div>
        <h3 id={id} className="text-base font-semibold">
          {title}
        </h3>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

// Every surface is shown with the foreground it is meant to be paired with, so a
// mismatched pair is visible rather than something you have to look up.
const CORE_SURFACES = [
  { label: 'background', bg: 'bg-background', fg: 'text-foreground' },
  { label: 'card', bg: 'bg-card', fg: 'text-card-foreground' },
  { label: 'popover', bg: 'bg-popover', fg: 'text-popover-foreground' },
  { label: 'muted', bg: 'bg-muted', fg: 'text-muted-foreground' },
  { label: 'accent', bg: 'bg-accent', fg: 'text-accent-foreground' },
] as const;

// Action fills. `destructive` pairs with literal white rather than a foreground token:
// that is what Button and Badge do, and the reference should show what ships. That
// includes the dark half: --destructive lightens in dark so it works as TEXT, which puts
// white on the SOLID fill at 2.89:1, so Button and Badge both damp it to 60% over the
// surface behind (5.6 to 6.7:1 depending on the surface). Shown the same way here, or
// this page would be presenting a failing pairing as an approved one.
const ACTIONS = [
  { label: 'primary', bg: 'bg-primary', fg: 'text-primary-foreground' },
  { label: 'secondary', bg: 'bg-secondary', fg: 'text-secondary-foreground' },
  { label: 'destructive', bg: 'bg-destructive dark:bg-destructive/60', fg: 'text-white' },
] as const;

const SEMANTIC_TEXT = [
  { role: 'Primary text', cls: 'text-foreground', sample: 'Assignment 3: Regular Expressions' },
  {
    role: 'Secondary / helper text',
    cls: 'text-muted-foreground',
    sample: 'Review and manage submissions across courses.',
  },
  // Shown as it actually ships, underline included: a swatch of plain blue text would be
  // demonstrating the bug this rule exists to prevent.
  {
    role: 'Link',
    cls: 'text-link underline decoration-1 underline-offset-2',
    sample: 'View submission',
  },
  {
    role: 'Link, hovered',
    cls: 'text-link-hover underline decoration-1 underline-offset-2',
    sample: 'View submission',
  },
  { role: 'Accent (not a link)', cls: 'text-primary', sample: 'Assigned to 3 sections' },
  { role: 'Success', cls: 'text-status-success', sample: 'Saved. Everything is up to date.' },
  { role: 'Warning', cls: 'text-status-warning', sample: 'This group set can no longer change.' },
  { role: 'Danger', cls: 'text-status-danger', sample: 'Failed to load users. Please try again.' },
  { role: 'Info', cls: 'text-status-info', sample: 'An in-app upgrade needs a host-side update.' },
] as const;

const STATUS = [
  {
    variant: 'success',
    text: 'text-status-success',
    bg: 'bg-status-success-bg',
    border: 'border-status-success-border',
    sample: 'Saved. Everything is up to date.',
    badge: 'Passed',
  },
  {
    variant: 'warning',
    text: 'text-status-warning',
    bg: 'bg-status-warning-bg',
    border: 'border-status-warning-border',
    sample: 'This group set has submissions and can no longer be changed.',
    badge: 'Pending',
  },
  {
    variant: 'danger',
    text: 'text-status-danger',
    bg: 'bg-status-danger-bg',
    border: 'border-status-danger-border',
    sample: 'Failed to load users. Please try again.',
    badge: 'Failed',
  },
  {
    variant: 'info',
    text: 'text-status-info',
    bg: 'bg-status-info-bg',
    border: 'border-status-info-border',
    sample: 'An in-app upgrade needs a host-side update afterward.',
    badge: 'Info',
  },
] as const;

// Saturated fills that carry white content. Kept apart from the four states above
// because they answer a different question: what goes behind a white glyph.
const SOLID_STATUS = [
  { label: 'success', cls: 'bg-status-success-solid' },
  { label: 'warning', cls: 'bg-status-warning-solid' },
  { label: 'danger', cls: 'bg-status-danger-solid' },
  { label: 'info', cls: 'bg-status-info-solid' },
  { label: 'neutral', cls: 'bg-status-neutral-solid' },
] as const;

// Six unrelated series. The name beside each one is the hue, not a meaning: chart-6 is
// "series 6", not "success". Class strings are literal so Tailwind emits them.
const CHART_CATEGORICAL = [
  { label: 'Cobalt', cls: 'bg-chart-1', token: 'chart-1' },
  { label: 'Violet', cls: 'bg-chart-2', token: 'chart-2' },
  { label: 'Orange', cls: 'bg-chart-3', token: 'chart-3' },
  { label: 'Rose', cls: 'bg-chart-4', token: 'chart-4' },
  { label: 'Gold', cls: 'bg-chart-5', token: 'chart-5' },
  { label: 'Green', cls: 'bg-chart-6', token: 'chart-6' },
] as const;

// One quantity getting bigger. Shown as a continuous strip rather than six cards, because
// what matters about a sequential scale is that the steps read in order.
const CHART_SEQUENTIAL = [
  { cls: 'bg-chart-sequential-1', token: 'chart-sequential-1' },
  { cls: 'bg-chart-sequential-2', token: 'chart-sequential-2' },
  { cls: 'bg-chart-sequential-3', token: 'chart-sequential-3' },
  { cls: 'bg-chart-sequential-4', token: 'chart-sequential-4' },
  { cls: 'bg-chart-sequential-5', token: 'chart-sequential-5' },
] as const;

// The approved hierarchy, as classes rather than prose, so a heading that drifts off the
// scale can be compared against the real thing.
const TYPE_ROLES = [
  { role: 'Page Title', cls: 'text-2xl font-semibold tracking-tight', sample: 'Assignments' },
  { role: 'Section Title', cls: 'text-xl font-semibold', sample: 'Courses' },
  { role: 'Module Title', cls: 'text-base font-semibold', sample: 'Upcoming deadlines' },
  { role: 'Primary UI Text', cls: 'text-sm', sample: 'Assignment 3: Regular Expressions' },
  {
    role: 'Supporting Description',
    cls: 'text-sm text-muted-foreground',
    sample: 'Review and manage submissions across courses.',
  },
  {
    role: 'Metadata / Helper',
    cls: 'text-xs text-muted-foreground',
    sample: 'student@psu.edu',
  },
  {
    role: 'Dense Annotation',
    cls: 'text-2xs text-muted-foreground',
    sample: 'Dense chart annotation',
  },
] as const;

/** A surface swatch that shows its paired foreground instead of a blank rectangle. */
function PairSwatch({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <div className="border-border overflow-hidden rounded-md border">
      <div className={`flex h-14 items-center justify-center ${bg} ${fg}`}>
        <span className="text-sm font-medium">Aa Sample</span>
      </div>
      <div className="bg-card space-y-1 p-2">
        <div className="text-foreground text-xs font-medium">{label}</div>
        <div className="flex flex-wrap gap-1">
          <Cls>{bg}</Cls>
          <Cls>{fg}</Cls>
        </div>
      </div>
    </div>
  );
}

/**
 * A miniature of the real sidebar rather than a strip of isolated colours. The tokens
 * only mean anything in relation to each other: the active pill has to be readable on
 * the rail, the hover fill has to separate from it without shouting. Non-interactive on
 * purpose (dead buttons would be an accessibility regression on a reference page), so
 * the hover row is labelled in text.
 */
function SidebarPreview() {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="bg-sidebar border-sidebar-border w-60 rounded-lg border p-3">
        <p className="text-sidebar-muted-foreground text-2xs px-2 pb-2 font-medium tracking-wide uppercase">
          Course
        </p>
        <ul className="space-y-1">
          <li className="text-sidebar-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
            <LayoutDashboard className="size-4" aria-hidden="true" />
            Dashboard
          </li>
          <li className="bg-sidebar-accent text-sidebar-accent-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
            <BookOpen className="size-4" aria-hidden="true" />
            <span className="flex-1">Courses</span>
            <span className="text-sidebar-muted-foreground text-2xs">hover</span>
          </li>
          <li className="bg-sidebar-primary text-sidebar-primary-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium">
            <FileCheck className="size-4" aria-hidden="true" />
            <span className="flex-1">Submissions</span>
            <span className="text-2xs">active</span>
          </li>
        </ul>
        <hr className="border-sidebar-border my-3" />
        <p className="text-sidebar-muted-foreground px-2 text-xs">Secondary label</p>
      </div>
      <ul className="text-muted-foreground min-w-56 flex-1 space-y-1 text-sm">
        <li>
          Rail: <Cls>bg-sidebar</Cls> <Cls>border-sidebar-border</Cls>
        </li>
        <li>
          Item: <Cls>text-sidebar-foreground</Cls>
        </li>
        <li>
          Hover: <Cls>bg-sidebar-accent</Cls> <Cls>text-sidebar-accent-foreground</Cls>
        </li>
        <li>
          Active: <Cls>bg-sidebar-primary</Cls> <Cls>text-sidebar-primary-foreground</Cls>
        </li>
        <li>
          Label: <Cls>text-sidebar-muted-foreground</Cls>
        </li>
      </ul>
    </div>
  );
}

export function DesignTokens() {
  return (
    <div className="space-y-8">
      <TokenSection
        id="tokens-core-surfaces"
        title="Core Surfaces"
        description="The structural fills, each shown with the foreground token it pairs with. If a pair looks wrong here, it is wrong everywhere."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CORE_SURFACES.map((s) => (
            <PairSwatch key={s.label} {...s} />
          ))}
        </div>
      </TokenSection>

      <TokenSection
        id="tokens-actions"
        title="Actions & Selection"
        description="Fills that mean an action or a selected state. Cobalt is the action colour; secondary is the quiet neutral beside it."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {ACTIONS.map((a) => (
            <PairSwatch key={a.label} {...a} />
          ))}
          {/* tab-active is a FOREGROUND token, not a surface: painting a swatch with
              bg-tab-active would suggest white text on it, which is unreadable in dark
              mode where the token is a light blue. Shown as the nav item it actually is. */}
          <div className="border-border overflow-hidden rounded-md border">
            <div className="bg-card flex h-14 items-center justify-center p-2">
              <span className="border-tab-active bg-tab-active-bg text-tab-active rounded-md border px-3 py-1.5 text-sm font-medium">
                Submissions
              </span>
            </div>
            <div className="bg-card space-y-1 p-2">
              <div className="text-foreground text-xs font-medium">tab-active</div>
              <div className="flex flex-wrap gap-1">
                <Cls>text-tab-active</Cls>
                <Cls>bg-tab-active-bg</Cls>
                <Cls>border-tab-active</Cls>
              </div>
            </div>
          </div>
        </div>
        {/* The two shapes of the same navigation, beside each other. They drifted once:
            the strip filled with the sidebar's charcoal while the rail used a soft
            tab-active tint, and nothing on any page showed the two together. */}
        <div className="border-border bg-muted/30 space-y-2 rounded-md border p-3">
          <p className="text-foreground text-sm font-medium">Local navigation, both shapes</p>
          <p className="text-muted-foreground text-sm">
            The horizontal strip and the vertical rail are one system at two widths, so they read
            from the same tokens. If these two stop matching, something has drifted.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="bg-card border-border rounded-md border p-2">
              <div className="border-border flex items-center gap-2 border-b">
                <span className="text-tab-active bg-tab-active-bg border-tab-active border-0 border-b-4 px-2 py-2 text-sm font-semibold">
                  Assignments
                </span>
                <span className="text-muted-foreground border-0 border-b-4 border-transparent px-2 py-2 text-sm font-medium">
                  Problems
                </span>
              </div>
              <p className="text-muted-foreground pt-2 text-xs">Horizontal, active tab</p>
            </div>
            <div className="bg-card border-border overflow-hidden rounded-md border">
              <div className="text-tab-active bg-tab-active-bg relative flex h-10 items-center px-4 text-sm font-medium">
                <span
                  className="bg-tab-active absolute inset-y-0 left-0 w-[3px]"
                  aria-hidden="true"
                />
                Assignments
              </div>
              <div className="border-border text-foreground flex h-10 items-center border-t px-4 text-sm font-medium">
                Problems
              </div>
              <p className="text-muted-foreground px-4 pt-1 pb-2 text-xs">Vertical, active row</p>
            </div>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          <Cls>tab-active</Cls> is navigation and selection state, not a general-purpose surface: it
          marks the current tab or local-navigation rail item, and the vertical rail reads it from
          this token rather than spelling out a dark blue of its own. It is cobalt in light, aligned
          with <Cls>primary</Cls>, and a lighter blue in dark so the label keeps its contrast on the
          dark card.
        </p>
      </TokenSection>

      <TokenSection
        id="tokens-text"
        title="Text & Borders"
        description="The semantic text roles and the structural tokens, all of them theme-aware. Never a hardcoded palette colour."
      >
        <div className="border-border bg-card divide-border divide-y rounded-md border">
          {SEMANTIC_TEXT.map((t) => (
            <div
              key={t.cls}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3"
            >
              <span className={`text-sm ${t.cls}`}>{t.sample}</span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">{t.role}</span>
                <Cls>{t.cls}</Cls>
              </span>
            </div>
          ))}
        </div>
        <div className="border-border bg-muted/30 space-y-1 rounded-md border p-3">
          <p className="text-foreground text-sm font-medium">Links are underlined at rest</p>
          <p className="text-muted-foreground text-sm">
            A conventional text link carries an underline before you hover it, so its state is not
            conveyed by colour alone (WCAG 1.4.1). Colour cannot carry it: the link token is 2.7:1
            against body text and about 1:1 against <Cls>text-muted-foreground</Cls>, so a file name
            beside its upload date would be indistinguishable. Use <Cls>TEXT_LINK_CLASS</Cls> from{' '}
            <Cls>lib/link-styles</Cls>. Structural navigation — tabs, breadcrumbs, menus, the rail,
            sidebar items — needs no underline, because its role is already obvious from where it
            sits.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="border-border bg-card space-y-2 rounded-md border p-3">
            <div className="border-border h-8 rounded border" aria-hidden="true" />
            <Cls>border-border</Cls>
            <p className="text-muted-foreground text-xs">Dividers and card edges.</p>
          </div>
          <div className="border-border bg-card space-y-2 rounded-md border p-3">
            <div className="border-input h-8 rounded border" aria-hidden="true" />
            <Cls>border-input</Cls>
            <p className="text-muted-foreground text-xs">Form-control edges only.</p>
          </div>
          <div className="border-border bg-card space-y-2 rounded-md border p-3">
            <div className="ring-ring/70 h-8 rounded ring-[3px]" aria-hidden="true" />
            <Cls>ring-ring/70</Cls>
            <p className="text-muted-foreground text-xs">Focus-visible ring.</p>
          </div>
        </div>
        <div className="border-border bg-muted/30 space-y-1 rounded-md border p-3">
          <p className="text-foreground text-sm font-medium">Which border, and why it matters</p>
          <ul className="text-muted-foreground space-y-1 text-sm">
            <li>
              <Cls>border-border</Cls> is structure: card edges, dividers, row separators. It may be
              quiet, because the content it surrounds is legible without it.
            </li>
            <li>
              <Cls>border-input</Cls> is the boundary of something you operate: fields, selects,
              textareas, outline buttons. It has to hold 3:1 against the surface behind it (WCAG
              1.4.11), because a control filled with <Cls>bg-card</Cls> on a card has nothing else
              showing where it is.
            </li>
            <li>
              <Cls>ring-ring/70</Cls> is the keyboard focus indicator, and 1.4.11 applies to it too.
              Judge the RENDERED ring: it is drawn through an opacity, so the token&rsquo;s own
              ratio is not the number that counts. At <Cls>/50</Cls> this blended to 1.7:1.
            </li>
          </ul>
        </div>
      </TokenSection>

      <TokenSection
        id="tokens-form-controls"
        title="Form Controls"
        description="The real shared controls, deliberately sitting on a muted grouping panel. Controls are bg-card in both themes: if one of these goes transparent the panel shows through and the regression is obvious here first."
      >
        <div className="bg-muted/30 border-border space-y-4 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tokens-text-input">Text input</Label>
              <Input
                id="tokens-text-input"
                placeholder="Assignment title"
                autoComplete="off"
                readOnly
              />
            </div>
            <SelectField
              label="Select"
              name="tokens-select"
              id="tokens-select"
              placeholder="Choose a problem type"
              options={[
                { value: 'fa', label: 'Finite Automaton' },
                { value: 're', label: 'Regular Expression' },
                { value: 'cfg', label: 'Context-Free Grammar' },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tokens-textarea">Description</Label>
            <Textarea
              id="tokens-textarea"
              placeholder="Describe what students should submit."
              autoComplete="off"
              readOnly
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="tokens-input-normal">Normal</Label>
              <Input id="tokens-input-normal" defaultValue="Ready" autoComplete="off" readOnly />
              <p className="text-muted-foreground text-xs">
                <Cls>bg-card</Cls> <Cls>border-input</Cls>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tokens-input-disabled">Disabled</Label>
              <Input id="tokens-input-disabled" defaultValue="Locked" autoComplete="off" disabled />
              <p className="text-muted-foreground text-xs">
                <Cls>disabled:opacity-50</Cls>
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tokens-input-invalid">Invalid</Label>
              <Input
                id="tokens-input-invalid"
                defaultValue="not-an-email"
                aria-invalid
                aria-describedby="tokens-input-invalid-error"
                autoComplete="off"
                readOnly
              />
              <p id="tokens-input-invalid-error" className="text-status-danger text-xs">
                Enter a valid email address.
              </p>
            </div>
          </div>
        </div>
      </TokenSection>

      <TokenSection
        id="tokens-tables"
        title="Tables"
        description="Tables have their own family so a header can sit one rung above the body without borrowing a surface token. This is the token sample, not a functional table."
      >
        <div className="border-border overflow-hidden rounded-md border">
          <Table className="bg-table-background">
            <TableHeader>
              <TableRow className="bg-table-header hover:bg-table-header">
                <TableHead className="text-table-header-foreground">Name</TableHead>
                <TableHead className="text-table-header-foreground">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="hover:bg-table-highlight">
                <TableCell>Alpha</TableCell>
                <TableCell>Active</TableCell>
              </TableRow>
              <TableRow className="hover:bg-table-highlight">
                <TableCell>Beta</TableCell>
                <TableCell>Pending</TableCell>
              </TableRow>
              {/* The highlight applied, rather than only on hover, so the token is visible
                  without a pointer (and in a screenshot). */}
              <TableRow className="bg-table-highlight hover:bg-table-highlight">
                <TableCell>Gamma</TableCell>
                <TableCell>Closed</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground text-sm">
          <Cls>bg-table-background</Cls> body, <Cls>bg-table-header</Cls> with{' '}
          <Cls>text-table-header-foreground</Cls> for the header, and <Cls>bg-table-highlight</Cls>{' '}
          for the hovered or highlighted row (shown applied on the last row).
        </p>
      </TokenSection>

      <TokenSection
        id="tokens-status"
        title="Status / Feedback"
        description="One family (--status-*) drives badges, inline status text, alert callouts, and toasts. Each state has a foreground, a soft -bg, and a -border."
      >
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
        <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-md border p-3">
          <Badge variant="neutral">Closed</Badge>
          <p className="text-muted-foreground text-sm">
            Neutral is badge and status metadata, not a success/warning/error alert family: it
            labels a state with no verdict attached. There is no neutral callout or toast, and a
            general neutral surface is already covered by <Cls>muted</Cls> and <Cls>accent</Cls>.
          </p>
        </div>
        <p className="text-muted-foreground text-sm">
          Badges use the same values through{' '}
          <Cls>{'<Badge variant="success|warning|danger|info|neutral" />'}</Cls>.
        </p>
      </TokenSection>

      <TokenSection
        id="tokens-solid-status"
        title="Solid Status Colors"
        description="Saturated fills for the same states, used where WHITE content sits on the fill (a toast's icon strip, a filled success button). That is the whole contract: each of these is validated against white, not against the page, so it stays a mid shade in both themes rather than lightening to stand out on a dark card."
      >
        <div className="flex flex-wrap gap-3">
          {SOLID_STATUS.map((s) => (
            <div key={s.cls} className="flex items-center gap-2">
              <span
                className={`flex size-8 items-center justify-center rounded-full ${s.cls}`}
                aria-hidden="true"
              >
                <Check className="size-4 text-white" />
              </span>
              <span className="space-y-0.5">
                <span className="text-foreground block text-xs font-medium">{s.label}</span>
                <Cls>{s.cls}</Cls>
              </span>
            </div>
          ))}
        </div>
      </TokenSection>

      <TokenSection
        id="tokens-sidebar"
        title="Sidebar"
        description="Its own family, and the same dark surface in both themes. Shown as a miniature rail because these tokens only mean anything in relation to each other."
      >
        <SidebarPreview />
      </TokenSection>

      <TokenSection
        id="tokens-data-viz"
        title="Data Visualization"
        description="Two families, and picking the wrong one is the mistake worth avoiding. These are the only place in the app where colour carries data rather than state."
      >
        <div className="space-y-3">
          <div>
            <h4 className="text-foreground text-sm font-semibold">Categorical Palette</h4>
            <p className="text-muted-foreground text-sm">
              Six colours that distinguish unrelated data series. They do not imply status:{' '}
              <Cls>chart-6</Cls> is series six, not success. Use them in order, so series one is
              cobalt on every chart in the app.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {CHART_CATEGORICAL.map((c) => (
              <div key={c.token} className="border-border overflow-hidden rounded-md border">
                <div className={`h-10 ${c.cls}`} aria-hidden="true" />
                <div className="bg-card space-y-0.5 p-2">
                  <div className="text-foreground text-xs font-medium">{c.label}</div>
                  <Cls>{c.token}</Cls>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <div>
            <h4 className="text-foreground text-sm font-semibold">Sequential Scale</h4>
            <p className="text-muted-foreground text-sm">
              One quantity, increasing. Step five is always the most of something. Used by the
              activity heatmap and the attempts-to-solve bars. In light mode the ramp runs light to
              dark; in dark mode it runs dark to light, because &ldquo;darker means more&rdquo;
              cannot work on a dark card. The direction, low to high, is the same in both.
            </p>
          </div>
          <div className="border-border flex overflow-hidden rounded-md border" aria-hidden="true">
            {CHART_SEQUENTIAL.map((c) => (
              <div key={c.token} className={`h-10 flex-1 ${c.cls}`} />
            ))}
          </div>
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>Low</span>
            <Cls>bg-chart-sequential-1 … -5</Cls>
            <span>High</span>
          </div>
        </div>

        <p className="text-muted-foreground text-sm">
          When the colour means success, warning, danger or informational state rather than a data
          series, neither family is right: use the status tokens above. A submission bar broken down
          by outcome is status; a line per metric is categorical; a heatmap cell is sequential.
        </p>
      </TokenSection>

      <TokenSection
        id="tokens-typography"
        title="Typography Roles"
        description="The approved hierarchy, in Geist. The Fonts tab compares families; this compares roles."
      >
        <div className="border-border bg-card divide-border divide-y rounded-md border">
          {TYPE_ROLES.map((t) => (
            <div
              key={t.role}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3"
            >
              <span className={t.cls}>{t.sample}</span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">{t.role}</span>
                <Cls>{t.cls}</Cls>
              </span>
            </div>
          ))}
        </div>
      </TokenSection>
    </div>
  );
}
