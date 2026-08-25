import type React from 'react';

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
  className,
  boxed = true,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  className?: string;
  boxed?: boolean;
  children: React.ReactNode;
}) {
  const id = settingsSectionId(title);

  // h2, under the page's "System Settings" h1. A major group must not look like a field
  // label, which is what text-sm font-medium made it, nor compete with the page title.
  const header = (
    <div className="space-y-1">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {description ? (
        <p className="text-muted-foreground max-w-3xl text-sm">{description}</p>
      ) : null}
    </div>
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
 * The two-column grid a status tab uses: the form, and a narrow rail beside it.
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
export const SETTINGS_STATUS_GRID =
  'grid grid-cols-1 gap-6 min-[1400px]:grid-cols-[minmax(0,1fr)_18rem] 2xl:grid-cols-[minmax(0,1fr)_20rem]';

/**
 * A tab that answers two questions at once: what is set up now, and what do I want to change.
 *
 * The form is the main column; the current state sits beside it on a wide screen and above
 * it on a narrow one. Status goes FIRST in the DOM deliberately. Stacked, that is the order
 * you want (know the state, then edit it), and it means the visual and reading orders differ
 * only in the one place they must: on a wide screen the rail is placed into column two.
 * Keep the status copy short for the same reason, or a phone gets a paragraph before the form.
 *
 * Layout only. Nothing here knows what a certificate or an SMTP host is.
 */
export function SettingsStatusLayout({
  statusTitle,
  status,
  className,
  children,
}: {
  /** The rail's heading, e.g. "Current status" or "Current certificate". */
  statusTitle: string;
  status: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const id = settingsSectionId(statusTitle);
  return (
    <div className={cn(SETTINGS_WORKSPACE, SETTINGS_STATUS_GRID, 'items-start', className)}>
      {/* Sticky at the same offset as the Settings Menu rail, and for the same reason: on
          the long tabs (Sign-in, TLS) the state you are changing is worth keeping in view
          while you scroll the flow that changes it. No ancestor sets overflow, which is
          what would otherwise make position:sticky a no-op. */}
      <aside
        aria-labelledby={id}
        className="space-y-3 min-[1400px]:sticky min-[1400px]:top-6 min-[1400px]:col-start-2 min-[1400px]:row-start-1"
      >
        <h2 id={id} className="text-base font-semibold">
          {statusTitle}
        </h2>
        {status}
      </aside>

      <div className="min-w-0 space-y-6 min-[1400px]:col-start-1 min-[1400px]:row-start-1">
        {children}
      </div>
    </div>
  );
}

/**
 * The neutral "here is what is currently configured" panel that Email, Sign-in, Captcha and
 * TLS each open with. Deliberately `bg-muted` and not a status colour: it reports a state,
 * it is not itself a success or a warning. The Badge inside carries that.
 */
export function SettingsStatusPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // rounded-lg to match the settings panels beside it, and bg-muted deliberately: the
    // panel reports a state, it is not itself a success or a warning. The Badge inside
    // carries that, which is why this never turns green or red.
    <div className={cn('bg-muted space-y-2 rounded-lg border p-4 text-sm', className)}>
      {children}
    </div>
  );
}
