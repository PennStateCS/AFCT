import type React from 'react';

import { CircleAlert, CircleCheck, CircleOff } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SETTINGS_BOX_CLASS } from './system-settings-shared';

/**
 * The width vocabulary for System Settings.
 *
 * The workspace itself is wide; the CONTENT inside it is not, and those are two different
 * decisions. A settings page that stops at 768px wastes a 1920px monitor, but a page that
 * lets every field grow to fill it produces a 1000px box for a port number. So the
 * workspace opens up and each section picks the measure its content actually wants.
 *
 * Roughly: prose stays inside a readable line length, ordinary forms sit at a comfortable
 * form width, technical URLs get enough room to be inspected without scrolling, and tables
 * and logs, which genuinely benefit from horizontal space, take the lot.
 */
export const SETTINGS_WORKSPACE = 'w-full max-w-6xl';
/** Explanatory prose and security notes. Long enough to read, short enough to scan. */
export const SETTINGS_READABLE = 'w-full max-w-4xl';
/** The default for a settings panel: forms, status, grouped controls. */
export const SETTINGS_STANDARD = 'w-full max-w-5xl';
/** A short form with a couple of fields, where a wide box would just be empty. */
export const SETTINGS_COMPACT = 'w-full max-w-3xl';
/** Tables, restore points, live logs: content that reads better wide. */
export const SETTINGS_WIDE = 'w-full max-w-6xl';

/** A stable id from the visible title, so the heading and its section stay associated. */
export function settingsSectionId(title: string) {
  return `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/**
 * One titled group of settings.
 *
 * Every tab was building this by hand, and they had drifted: some used a bordered card,
 * some a bare `mt-6 border-t pt-5`, and the headings ranged from `text-sm font-medium` to
 * `text-base font-semibold`, which meant a major section could look exactly like a field
 * label. One component, so equivalent hierarchy looks equivalent.
 *
 * The heading sits INSIDE the panel, which is how the rest of AFCT works: CardTitle lives
 * in CardHeader inside the card, and the settings pages were the outlier. Outside, a
 * heading floated 12px above its own panel and 24px below the previous one, which is a
 * weak enough ratio that it read as a caption between two boxes rather than the title of
 * the one below it. Inside, a section is one object.
 *
 * `className` takes the width, because that is the one thing that legitimately differs per
 * section. `boxed={false}` drops the card for a group that is only a heading and some
 * prose, where a border would imply a form that is not there; that variant keeps its
 * heading outside for the obvious reason that there is no panel to put it in.
 */
export function SettingsSection({
  title,
  description,
  action,
  className,
  boxed = true,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  /** A control that belongs to this section, e.g. "Add an LMS", shown beside the heading. */
  action?: React.ReactNode;
  className?: string;
  boxed?: boolean;
  children: React.ReactNode;
}) {
  const id = settingsSectionId(title);

  // h2, under the page's "System Settings" h1. A major group must not look like a field
  // label, which is what text-sm font-medium made it, nor compete with the page title.
  const heading = (
    <div className="space-y-1">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {description ? (
        <p className="text-muted-foreground max-w-3xl text-sm">{description}</p>
      ) : null}
    </div>
  );

  // The action sits on the heading's row, not out at the panel's far edge: a button that
  // far from its list reads as belonging to the page. flex-wrap so it drops under the
  // heading at 390px rather than squeezing it.
  const header = action ? (
    <div className="flex flex-wrap items-start justify-between gap-4">
      {heading}
      <div className="shrink-0">{action}</div>
    </div>
  ) : (
    heading
  );

  if (!boxed) {
    return (
      <section aria-labelledby={id} className={cn('space-y-3', className)}>
        {header}
        {children}
      </section>
    );
  }

  return (
    <section aria-labelledby={id} className={className}>
      <div className={cn('bg-card', SETTINGS_BOX_CLASS)}>
        {header}
        {children}
      </div>
    </section>
  );
}

/**
 * The two-column grid an aside tab uses: the form, and a narrow rail beside it.
 *
 * Exported because the Save row has to line up with the form column and lives outside the
 * tab that draws the grid. Giving the footer the same template and putting it in column 1
 * makes them agree by construction, rather than by two max-widths that have to be kept in
 * step by hand.
 *
 * The breakpoint is measured, not picked off the scale.
 *
 * Two rails are already in front of this content: the dashboard sidebar (~255px) and the
 * Settings Menu (240px + a 24px gutter), so the workspace starts about 567px narrower than
 * the viewport. Splitting it again needs the form to keep ~520px, which is where the Email
 * tab's From address stops truncating, plus the 288px rail and its 24px gap. That lands at
 * about 1400px. At Tailwind's `xl` (1280) the form came out at 386px with every helper on
 * three lines and the address cut off, which is the cramped two-column case to avoid; at
 * `2xl` (1536) a 1440px laptop would lose the rail for no reason.
 *
 * 18rem is enough for a badge and a short paragraph and not enough to compete with the
 * form; 20rem once there is room to spare.
 */
export const SETTINGS_ASIDE_GRID =
  'grid grid-cols-1 gap-6 min-[1400px]:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_20rem]';

/**
 * A tab that answers two questions at once: what do I want to change, and what should I know
 * while I change it. Four tabs put their current state in the rail; General puts the server's
 * public address there, which is reference rather than status, hence the neutral name.
 *
 * The form is the main column; the rail sits beside it on a wide screen and above it on a
 * narrow one. The rail goes FIRST in the DOM deliberately. Stacked, that is the order
 * you want (know the state, then edit it), and it means the visual and reading orders differ
 * only in the one place they must: on a wide screen the rail is placed into column two.
 * Keep the rail's copy short for the same reason, or a phone gets a paragraph before the form.
 *
 * Layout only. Nothing here knows what a certificate or an SMTP host is.
 */
export function SettingsAsideLayout({
  aside,
  asidePlacement = 'before',
  className,
  children,
}: {
  /** The rail's content: a {@link SettingsStatusCard}, or any {@link SettingsAsideCard}. */
  aside: React.ReactNode;
  /**
   * Where the rail goes once the columns stack, which is also its DOM order.
   *
   * `before` for a status summary: know the state, then edit it. `after` for reference
   * material like LTI's manual endpoints, which is the fallback path and should not sit
   * between a phone user and the workflow they came for.
   *
   * It changes nothing on a wide screen. Both columns are placed explicitly by row and
   * column, so the grid puts them side by side whichever order they are written in, and
   * no CSS has to reorder anything for the reading order to match what is on screen.
   */
  asidePlacement?: 'before' | 'after';
  className?: string;
  children: React.ReactNode;
}) {
  const railColumn = (
    <div className="min-[1400px]:sticky min-[1400px]:top-6 min-[1400px]:col-start-2 min-[1400px]:row-start-1">
      {aside}
    </div>
  );

  return (
    <div className={cn(SETTINGS_WORKSPACE, SETTINGS_ASIDE_GRID, 'items-start', className)}>
      {/* Positioning only. The landmark and the heading belong to the card inside, so the
          rail is one named region rather than an anonymous <aside> wrapping a titled box.

          Sticky at the same offset as the Settings Menu rail, and for the same reason: on
          the long tabs (Sign-in, TLS) the state you are changing is worth keeping in view
          while you scroll the flow that changes it. No ancestor sets overflow, which is
          what would otherwise make position:sticky a no-op. */}
      {asidePlacement === 'before' ? railColumn : null}

      <div className="min-w-0 space-y-6 min-[1400px]:col-start-1 min-[1400px]:row-start-1">
        {children}
      </div>

      {asidePlacement === 'after' ? railColumn : null}
    </div>
  );
}

/**
 * A tab with no rail, whose form should still line up with the tabs that have one.
 *
 * The same grid, with column two left empty. That is deliberately not "a max-width that
 * happens to match": the aside tabs' form column is `workspace - rail - gap`, which is
 * 840px below 2xl and 808px above it, and no fixed `max-w-*` tracks both. Sharing the
 * template makes them equal by construction instead of by two numbers kept in step by hand.
 *
 * Evaluator and the Backups schedule sat at SETTINGS_STANDARD (1024px) before this, which
 * was 216px wider than General's form at 1920 while the page as a whole stopped further
 * left, so clicking between tabs moved the right edge twice in opposite directions.
 */
export function SettingsFormLayout({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(SETTINGS_WORKSPACE, SETTINGS_ASIDE_GRID, 'items-start', className)}>
      <div className="min-w-0 space-y-6 min-[1400px]:col-start-1 min-[1400px]:row-start-1">
        {children}
      </div>
    </div>
  );
}

/**
 * The shell every card in the rail shares: a titled, quiet, self-labelling box.
 *
 * `bg-card`, the same surface as the form panels, so the rail reads as another panel in the
 * page rather than a different kind of thing. It also fixes the badges: a neutral badge's
 * fill is within a few percent of `bg-muted`, so on a muted card "Disabled" all but
 * disappeared, which is exactly the state that most needs to be legible.
 *
 * The card never takes a status colour. A green or red panel would make a standing
 * configuration summary read as a transient alert.
 *
 * The heading lives inside the box, and the box names itself with it, so the rail is one
 * named landmark rather than an anonymous aside wrapping a titled div.
 */
export function SettingsAsideCard({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const id = settingsSectionId(title);
  return (
    <aside
      aria-labelledby={id}
      className={cn('bg-card rounded-lg border p-5 shadow-xs', className)}
    >
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </aside>
  );
}

/**
 * How a status reads, not what it means.
 *
 * The tab decides which one applies; this only says which glyph and which semantic colour
 * go with it. One family (Lucide's circles) on purpose: a shield here and a triangle there
 * would make four tabs look like four systems.
 */
const STATUS_TONES = {
  ok: { Icon: CircleCheck, className: 'text-status-success' },
  off: { Icon: CircleOff, className: 'text-muted-foreground' },
  warn: { Icon: CircleAlert, className: 'text-status-warning' },
  bad: { Icon: CircleAlert, className: 'text-destructive' },
} as const;

export type SettingsStatusTone = keyof typeof STATUS_TONES;

/**
 * The "what is set up right now" summary that sits in a status tab's rail.
 *
 * Four fixed rungs, so the same glance works on every tab: the card's own title, then an
 * icon-and-badge row saying which state this is, then a one-line headline, then whatever
 * detail and next step the tab wants to add as children.
 *
 * `bg-muted` and never a status colour. The card reports a state; it is not itself a
 * success or a failure, and a card that turned green would make "enabled" shout louder
 * than the form it is describing. The badge, the icon and the words carry the meaning,
 * which is also why the icon is aria-hidden: it repeats what the badge already says.
 *
 * Presentation only. Which tone applies is the tab's decision (see each tab), because
 * "is this certificate trusted" is not something a layout file should know.
 */
export function SettingsStatusCard({
  title,
  tone,
  badge,
  headline,
  className,
  children,
}: {
  /** The card's own heading, e.g. "Current status" or "Current certificate". */
  title: string;
  tone: SettingsStatusTone;
  /** The state's name, as a Badge. Passed in because the label is often longer than the
   *  variant, e.g. "Enabled, but unavailable" or "Self-signed (built-in)". */
  badge: React.ReactNode;
  /** One short line: what is true right now. */
  headline: string;
  className?: string;
  /** Detail and, where there is one, the next step. Keep it to a few short lines. */
  children?: React.ReactNode;
}) {
  const { Icon, className: toneClass } = STATUS_TONES[tone];

  return (
    // No role="status": this is a summary of the current state, not a live region, and
    // announcing the whole card on every render would talk over the form beside it.
    <SettingsAsideCard title={title} className={className}>
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          {/* A neutral disc, with the colour on the glyph inside it. A bare 16px icon next
              to a badge read as a bullet point; the disc gives the row a fixed anchor so
              the state is identifiable before any of the words are. The disc stays muted
              in every state on purpose: tinting it too would be a second, larger colour
              field competing with the badge. */}
          <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full">
            <Icon className={cn('size-4', toneClass)} aria-hidden="true" />
          </span>
          {badge}
        </div>

        <p className="text-foreground text-sm font-semibold">{headline}</p>

        {children ? <div className="space-y-2">{children}</div> : null}
      </div>
    </SettingsAsideCard>
  );
}

/** A line of detail under a status headline. Quiet, and short enough for an 18rem rail. */
export function SettingsStatusText({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground text-xs leading-4.5">{children}</p>;
}

/**
 * The one thing to do about the state above, set slightly stronger than the detail around
 * it so it is findable without becoming a second headline. Not a button: these point at a
 * form that is already on screen.
 */
export function SettingsStatusNextStep({ children }: { children: React.ReactNode }) {
  return <p className="text-foreground text-xs leading-4.5 font-medium">{children}</p>;
}
