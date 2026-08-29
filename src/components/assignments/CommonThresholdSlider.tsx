'use client';

/**
 * The dial for where a common answer begins.
 *
 * One piece of markup for both places it appears: inline in the summary card when there is
 * room for it, and inside the Adjust popover when there is not. Two copies of a range input
 * would be two chances for the ends, the step or the announced value to drift apart, and the
 * reader would have no way to tell which one they were looking at.
 *
 * The ends are drawn because a bare slider says nothing about what its ends mean, and the
 * range here is not obvious: it stops at 5% rather than at nothing.
 */
export function CommonThresholdSlider({
  id,
  value,
  onChange,
  grow = false,
}: {
  /** Each place this appears needs its own id, since both are in the document at once. */
  id: string;
  /** The share of a problem's review subjects, 0.05 to 1. */
  value: number;
  onChange: (next: number) => void;
  /** Fill the width available, which is what the popover wants and the summary card does not. */
  grow?: boolean;
}) {
  const percent = Math.round(value * 100);

  return (
    <div className="flex items-center gap-2">
      {/* The ends label the track, and the value beside it is the answer, so a reader
          hearing the slider announced does not need them read out as well. */}
      <span aria-hidden="true" className="text-xs tabular-nums">
        5%
      </span>
      <input
        id={id}
        type="range"
        min="0.05"
        max="1"
        step="0.05"
        value={value}
        aria-valuetext={`${percent} percent of the class`}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`bg-primary-foreground accent-primary h-2 cursor-pointer rounded-lg ${
          grow ? 'flex-1' : 'w-52'
        }`}
      />
      <span aria-hidden="true" className="text-xs tabular-nums">
        100%
      </span>
      <span className="text-foreground w-10 text-end text-sm font-medium tabular-nums">
        {percent}%
      </span>
    </div>
  );
}
