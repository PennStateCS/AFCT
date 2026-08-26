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
/**
 * How much weight a banner carries.
 *
 * `identity` is the course page: the thing you navigated TO, the surface that says AFCT before
 * it says anything else. `operational` is the assignment page, one level down inside a course
 * that has already introduced itself, where the banner is mostly a place to publish from and
 * jump between assignments.
 *
 * The tone changes ONE thing, and that is the point. It used to carry its own padding and its
 * own height floor as well, which made the assignment banner physically shorter, and two
 * banners at 118px and 106px read as a component that had drifted rather than as a family with
 * two members. The shell is now identical and the difference is carried entirely by the
 * network weight and by what each page puts inside. A third tone means one more entry here, not
 * one more knob.
 */
export type IdentityTone = 'identity' | 'operational';

/**
 * The shell every banner shares: padding, and the desktop minimum both pages open at.
 *
 * One value in one place rather than a magic number per caller. 20px of vertical padding on a
 * desktop against 24 either side, because the banner should stay generous across and only as
 * tall as it needs to be.
 *
 * The 7.25rem is a MINIMUM and only above sm. It makes a page open at the same height whoever
 * is looking and whichever page they are on: a student gets no faculty line and an assignment
 * has less to say than a course, and without a floor each of those opened at a different height
 * and moved the content underneath. A long title, a second line of faculty, a wrapped badge row
 * or a wrapped control column all push past it, and on a phone the rows stack and there is no
 * spare height to hand out. `justify-center` on the same element is what distributes the spare
 * above and below rather than leaving it under the title.
 */
const BANNER_SHELL = 'px-4 py-4 sm:min-h-[7.25rem] sm:px-5 lg:px-6 lg:py-5';

/**
 * Same mesh, same palette, three quarters the weight on the quieter tone. Not a second SVG and
 * not a different crop: the figure is recognisably the one from the course page, standing
 * further back.
 */
const TONE_NETWORK = {
  identity: undefined,
  operational: 'opacity-[0.55] sm:opacity-75',
} as const satisfies Record<IdentityTone, string | undefined>;

export function IdentityPanel({
  children,
  labelledBy,
  tone = 'identity',
  className,
}: {
  children: React.ReactNode;
  /** Id of the banner's own heading, so the region is named by what it is about. */
  labelledBy: string;
  /** See IdentityTone. Defaults to the fuller course-page treatment. */
  tone?: IdentityTone;
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
      <IdentityNetwork className={TONE_NETWORK[tone]} />

      {/* Everything real sits above the decoration. The padding lives here rather than on the
          section so the network runs edge to edge behind it; see BANNER_SHELL. */}
      <div className={cn('relative flex flex-col justify-center gap-3', BANNER_SHELL)}>
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
 *
 * The slot is wider than it is tall, and that asymmetry is the second compaction lever. It used
 * to be square at 56, sized for a tile that no longer exists, so 20 of those 56 pixels were
 * blank space above and below a 36px glyph AND they set the height of the whole title row. The
 * width has to stay 56 because the metadata line indents to it; the height does not, so it comes
 * down to the glyph. The icon itself is unchanged at 36px, which is the point: this buys back
 * 18px of banner without making the course mark any smaller.
 */
export function IdentityPanelIcon({
  icon: Icon,
}: {
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    // Top-aligned by the caller, so it stays beside the first line when a title wraps.
    <span className="flex h-7 w-12 shrink-0 items-center justify-center sm:h-9 sm:w-14">
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
