/**
 * A small palette so a course can be told apart at a glance, on the calendar and in the
 * filter list beside it.
 *
 * Decorative only. AFCT's semantic tokens mean something (danger, warning), and cycling
 * them by course would say things that are not true; these are plain palette hues with
 * dark pairs. Colour is never the only signal: every chip and every filter row keeps its
 * course code as text.
 *
 * Keyed by course id rather than index, so a course keeps its colour when the filter set
 * changes or a month has no assignments from it. The hash is only a spreader, so a stable
 * id gives a stable colour without anything being stored.
 */
export type CourseColor = {
  /** The event chip: soft tint, matching border, readable text. */
  chip: string;
  /** The dot beside a filter row. */
  dot: string;
};

const PALETTE: readonly CourseColor[] = [
  {
    chip: 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200',
    dot: 'bg-blue-500',
  },
  {
    chip: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-200',
    dot: 'bg-violet-500',
  },
  {
    chip: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
    dot: 'bg-amber-500',
  },
  {
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  },
  {
    chip: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200',
    dot: 'bg-rose-500',
  },
] as const;

/** Stable, order-independent bucket for a course id. */
export function courseColor(courseId: string): CourseColor {
  let hash = 0;
  for (let i = 0; i < courseId.length; i += 1) {
    hash = (hash * 31 + courseId.charCodeAt(i)) | 0;
  }
  // The modulo is always in range; the non-null assertion is only for noUncheckedIndexedAccess.
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}
