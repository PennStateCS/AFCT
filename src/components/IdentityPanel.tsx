import { cn } from '@/lib/utils';

/**
 * The bounded, softly tinted shell that says "this page is about this one thing": a course,
 * an assignment. It holds the icon, the title, the metadata and the badges, and nothing else
 * on the page looks like it.
 *
 * Deliberately not a Card. A Card is what ordinary content sits in on these pages, so a
 * course or an assignment wrapped in one reads as another table. This is the one surface
 * that identifies the object, and it is meant to be distinguishable at a glance.
 *
 * Shared because there is exactly one of these treatments, not one per page. It started
 * inline in the course header; the assignment page needed the same thing, and two copies of
 * a gradient is how two pages quietly stop matching.
 *
 * The tint carries NONE of the meaning. Everything is still readable from the border, the
 * heading and the badge text alone, which is what keeps this honest when the wash all but
 * disappears in the high-contrast theme.
 */
export function IdentityPanel({
  children,
  labelledBy,
  className,
}: {
  children: React.ReactNode;
  /** Id of the panel's own heading, so the region is named by what it is about. */
  labelledBy: string;
  className?: string;
}) {
  return (
    // overflow-hidden clips the arcs to the panel; relative anchors them. shadow-xs rather
    // than a real shadow: the separation comes from the border and the tint, not from
    // floating above the page.
    <section
      aria-labelledby={labelledBy}
      className={cn(
        'border-border relative overflow-hidden rounded-xl border p-4 shadow-xs sm:p-5 lg:p-6',
        className,
      )}
    >
      {/* Blue on the left, mint on the right, the card colour between them, every stop a
          fraction so it stays barely stronger than the page behind it. Sky and emerald
          deliberately, and NOT teal: the app removed teal on purpose, and these two
          families have to stay visibly apart. */}
      <div
        aria-hidden="true"
        className="via-card pointer-events-none absolute inset-0 bg-gradient-to-r from-sky-50/80 to-emerald-50/70 dark:from-sky-950/25 dark:to-emerald-950/20"
      />
      {/* Two oversized circles, mostly off the right edge, so the emphasis lands in the
          empty space beside the badges and never behind the title. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-emerald-100/40 dark:bg-emerald-400/[0.06]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -bottom-20 size-64 rounded-full bg-sky-100/40 dark:bg-sky-400/[0.06]"
      />

      {/* Everything real sits above the decoration. */}
      <div className="relative flex flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * The icon tile an identity panel leads with. Emerald in both themes, matching the Book
 * that marks a course everywhere else in the app, so the panels read as one family.
 * Decorative: the heading beside it already names the thing.
 */
export function IdentityPanelIcon({
  icon: Icon,
}: {
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    // Top-aligned by the caller, so it stays beside the first line when a title wraps.
    <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 sm:size-12 dark:bg-emerald-950/40 dark:text-emerald-300">
      <Icon className="size-5 sm:size-6" aria-hidden="true" />
    </span>
  );
}
