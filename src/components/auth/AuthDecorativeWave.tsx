/** The strip's own coordinate space. Stretched to whatever the page is wide; see below. */
const W = 600;
const H = 150;

/**
 * One sine curve across the strip, as polyline points.
 *
 * Points rather than a hand-authored cubic path. The curves are decorative and get tuned by
 * eye, and four numbers you can nudge beat four control points you have to re-derive every
 * time the shape changes. At six-unit steps each line is 101 points.
 *
 * `base` is the height it oscillates about, `amp` how far it swings, `freq` how many full
 * cycles fit across the strip, and `phase` shifts it sideways.
 */
function curve(base: number, amp: number, freq: number, phase: number) {
  const points: string[] = [];
  for (let x = 0; x <= W; x += 6) {
    points.push(`${x},${(base + amp * Math.sin((x / W) * Math.PI * 2 * freq + phase)).toFixed(1)}`);
  }
  return points.join(' ');
}

/**
 * Nine lines evenly spaced down the strip, each shifted a little further along than the one
 * above it.
 *
 * The even spacing is what makes this read as a contour map rather than as water: parallel
 * lines at a constant interval are how height is drawn on a map, and the small phase step
 * between them is the drift that keeps them from looking printed. The lowest line runs off the
 * bottom of the strip, which is deliberate; the set should look like it continues past the
 * edge of the screen rather than stopping neatly on it.
 */
const LINES = Array.from({ length: 9 }, (_, i) => ({
  key: i,
  points: curve(38 + i * 13, 13, 1.5, i * 0.28),
  // One line carries the set. Nine at the same value is a texture with no depth, and turning
  // any of them brighter than this reads as a graph drawn on the page.
  opacity: i === 4 ? 0.28 : 0.13,
}));

/**
 * The contour lines along the foot of the signed-out pages.
 *
 * One colour throughout, taken from the caller as `currentColor`, so the whole set moves
 * together and there is nothing here to keep in sync with the palette.
 *
 * Brightest at the left and falling away to the right, which is not decoration for its own
 * sake: the footer pill sits at the left of the page, and the lines are what its backdrop blur
 * has to work with. Flat across the width, they were faint enough behind the pill to leave it
 * looking like a plain grey chip. The right-hand side is where the sign-in card is, and there
 * the lines want to be quieter, so one gradient serves both ends.
 *
 * Stretched with `preserveAspectRatio="none"` on purpose. The curves mean nothing, so
 * distorting them to whatever width the page has costs nothing and avoids either tiling or
 * cropping. Static, which is also what a reduced-motion preference would have asked for.
 */
export function AuthDecorativeWave({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <defs>
        {/* The id is a plain constant rather than `useId` because this renders once per page:
            it is the page ground, drawn by `AuthPageBackground`. */}
        <linearGradient id="afct-contour-falloff" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.25" />
        </linearGradient>
        <mask id="afct-contour-fade">
          <rect width={W} height={H} fill="url(#afct-contour-falloff)" />
        </mask>
      </defs>

      <g mask="url(#afct-contour-fade)">
        {LINES.map(({ key, points, opacity }) => (
          <polyline key={key} points={points} strokeOpacity={opacity} />
        ))}
      </g>
    </svg>
  );
}

export default AuthDecorativeWave;
