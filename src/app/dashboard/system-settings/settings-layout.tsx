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
    <div className={cn('bg-muted space-y-2 rounded-md border p-4 text-sm', className)}>
      {children}
    </div>
  );
}
