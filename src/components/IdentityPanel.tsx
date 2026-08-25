import { IdentityNetwork } from '@/components/IdentityNetwork';
import { cn } from '@/lib/utils';

/**
 * The branded navy banner that says "this page is about this one thing": a course, an
 * assignment. It holds the icon, the title, the metadata and the badges, and nothing else in
 * the app looks like it.
 *
 * Deliberately not a Card, and deliberately not themed. A Card is what ordinary content sits in
 * on these pages, so a course or an assignment wrapped in one reads as another table. This is
 * the one surface that identifies the object, and a course page should say AFCT before it says
 * anything else. It is dark in EVERY theme for the same reason the sidebar and the sign-in panel
 * are, and it does not inherit `bg-card` on purpose: the page around it stays light in light
 * mode.
 *
 * It used to be a pale sky-and-mint wash on the page tokens. That version followed the theme,
 * sat a fraction above the canvas, and read as a slightly nicer card.
 *
 * The consequence is the rule to remember when putting anything inside one: NOTHING in here may
 * use a page token or a `dark:` utility. Every colour comes from the `--course-banner-*` family
 * in globals.css, which is where the light, dark and high-contrast values are decided and where
 * their contrast is recorded. A stray `text-muted-foreground` in a child is near-black on navy
 * in light mode and there is no way to see that from the markup, which is the whole reason the
 * family exists. `IDENTITY_BADGE` and `IDENTITY_ICON_BUTTON` below cover the two cases that come
 * up most.
 *
 * Two layers: the ground gradient on the section itself, and the network over it. There was a
 * third for a while, a navy wash between them meant to keep the left quiet, and it is gone
 * because the network carries its own left-to-right weighting. Two mechanisms doing one job
 * multiplied, and the mesh on the left third came out at a fraction of a percent of opacity.
 */
export function IdentityPanel({
  children,
  labelledBy,
  className,
}: {
  children: React.ReactNode;
  /** Id of the banner's own heading, so the region is named by what it is about. */
  labelledBy: string;
  className?: string;
}) {
  return (
    // overflow-hidden clips the network to the rounded corners; relative anchors it. shadow-xs
    // rather than a real shadow: the separation comes from this being a different kind of thing
    // from the page, not from floating above it.
    <section
      aria-labelledby={labelledBy}
      className={cn(
        'border-course-banner-border text-course-banner-foreground relative overflow-hidden',
        'rounded-xl border bg-gradient-to-r shadow-xs',
        'from-course-banner via-course-banner-mid to-course-banner-accent',
        className,
      )}
    >
      <IdentityNetwork />

      {/*
        Everything real sits above the decoration. The padding lives here rather than on the
        section so the network runs edge to edge behind it.

        The min-height is what makes a page open at the same height whoever is looking. A student
        gets no faculty/TA/registration line, so without it their course banner came out at 116px
        against a staff member's 144 and the assignment table started in a different place for
        the two of them. The spare goes above and below rather than under the title. Not applied
        below sm, where the rows stack and there is no spare height to distribute.
      */}
      <div className="relative flex flex-col justify-center gap-3 p-4 sm:min-h-[8.5rem] sm:p-5 lg:p-6">
        {children}
      </div>
    </section>
  );
}

/**
 * The icon a banner leads with: a bare glyph, no tile.
 *
 * It had a translucent white square around it, which on a surface this dark read as a second
 * object rather than as part of the title. The span stays as a fixed slot even without the box,
 * because the metadata line below indents to its width; the geometry is doing real work whether
 * or not anything is painted on it. Decorative, since the heading beside it already names the
 * thing.
 */
export function IdentityPanelIcon({
  icon: Icon,
}: {
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    // Top-aligned by the caller, so it stays beside the first line when a title wraps.
    <span className="mt-0.5 flex size-12 shrink-0 items-center justify-center sm:size-14">
      <Icon className="size-7 sm:size-9" aria-hidden="true" />
    </span>
  );
}

/**
 * Every plain badge in a banner, in one class.
 *
 * A light neutral chip. Two things rule out the ordinary badge variants here. Their fills are
 * page tokens, so in dark mode they turn into a dark translucent surface, which on a navy banner
 * is a chip you can barely find; and their text colours flip with the theme while the banner
 * does not, so a variant that reads in light mode disappears in dark. This is fixed in every
 * theme: 16.2:1 for the label, and the chip itself is unmistakable against the navy.
 *
 * A status badge losing its hue to this costs nothing as long as the word still carries the
 * meaning, which is the test to apply before reaching for it. Colour was never allowed to be the
 * only signal anyway. Where two chips genuinely need telling apart at a glance, give them fixed
 * light tints rather than semantic tokens; the assignment banner's group/individual pair is the
 * worked example.
 */
export const IDENTITY_BADGE = 'border-white/30 bg-white/90 text-slate-900';

/**
 * An icon-only ghost button in a banner.
 *
 * Spelled out rather than left to the ghost variant, which is built from page tokens: its
 * `text-foreground` is near-black in light mode, its `hover:bg-accent` is a pale grey box, and
 * its cobalt focus ring does not clear 3:1 on navy.
 */
export const IDENTITY_ICON_BUTTON =
  'size-6 text-white/70 hover:bg-white/15 hover:text-white dark:hover:bg-white/15 ' +
  'focus-visible:border-white focus-visible:ring-white/80';

/**
 * A hyperlink in a banner. Underlined at rest, like every other text link in the app, because
 * colour is not allowed to be the only thing marking a link.
 */
export const IDENTITY_LINK =
  'text-course-banner-muted-foreground hover:text-course-banner-foreground underline ' +
  'decoration-1 underline-offset-2 focus-visible:ring-white/80';
