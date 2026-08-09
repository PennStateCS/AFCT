'use client';

type ProgressRingProps = {
  /** Caption under the figure, e.g. "Graded" or "Assignment score". */
  label: string;
  /** How much of `total` has been achieved. */
  value: number;
  total: number;
  /** Shown inside the ring. Defaults to "value/total". */
  display?: string;
  /**
   * Spoken instead of the ring, which is decorative. Say the thing in words: a donut
   * conveys nothing without one, and a percentage alone rarely answers the question.
   */
  srLabel: string;
  /**
   * How to draw the part that is NOT achieved. 'danger' reads it as points lost, which is
   * only true once everything has been graded: before that the remainder is unknown, not
   * lost, and a red ring would accuse a student of losing marks nobody has awarded yet.
   */
  remainderTone?: 'muted' | 'danger';
  className?: string;
};

/**
 * A small progress donut with its figure inside it.
 *
 * The ring is `aria-hidden` and the numbers carry the meaning, so nothing depends on seeing
 * the arc or distinguishing its colour. That also keeps it honest at a glance: the figure is
 * always readable even when the arc is too short to interpret.
 */
export function ProgressRing({
  label,
  value,
  total,
  display,
  srLabel,
  remainderTone = 'muted',
  className = '',
}: ProgressRingProps) {
  // An empty assignment (no points, no problems) is 0/0. Treat it as complete rather than
  // dividing by zero: there is nothing outstanding.
  const fraction = total > 0 ? Math.min(1, Math.max(0, value / total)) : 1;
  // Sized to hold the figure inside it: "90/210" overflowed a 48px ring.
  const radius = 16;
  const circumference = 2 * Math.PI * radius;

  return (
    // Laid out like the dated cells beside it on the strip: a mark on the left, the label
    // above its value. The ring IS the icon, so these read as the same kind of fact rather
    // than a chart parked next to some text.
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative hidden h-10 w-10 shrink-0 xl:block">
        <svg viewBox="0 0 40 40" className="h-10 w-10 -rotate-90" aria-hidden="true">
          <circle
            cx="20"
            cy="20"
            r={radius}
            fill="none"
            strokeWidth="4"
            className={remainderTone === 'danger' ? 'stroke-status-danger-solid' : 'stroke-muted'}
          />
          <circle
            cx="20"
            cy="20"
            r={radius}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            className="stroke-brand-teal"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
          />
        </svg>
      </div>
      <div className="min-w-0">
        <div aria-hidden="true" className="text-muted-foreground text-xs">
          {label}
        </div>
        <div aria-hidden="true" className="text-sm font-medium tabular-nums">
          {display ?? `${value}/${total}`}
        </div>
      </div>
      <span className="sr-only">{srLabel}</span>
    </div>
  );
}

export default ProgressRing;
