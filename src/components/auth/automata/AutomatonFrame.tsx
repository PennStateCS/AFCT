import type React from 'react';

/**
 * The frame every decorative automaton is drawn in: one viewBox, one arrowhead marker, one
 * set of type sizes and stroke weights.
 *
 * Shared so the five diagrams differ by topology and nothing else. They crossfade into each
 * other, so a different stroke weight or state radius between two of them would read as the
 * drawing flinching rather than as a different automaton.
 *
 * `arrowId` is per-diagram because all five are mounted at once during the fade, and two
 * markers with the same id in one document is one marker.
 */
export const AUTOMATON_VIEWBOX = '0 0 444 234';

/** Normal state, accepting state's outer ring, and the ring inside it. */
export const R = 28;
export const R_ACCEPT = 32;
export const R_ACCEPT_INNER = 26;

/** What every one of the five diagrams accepts, so the rotator can treat them alike. */
export type AutomatonProps = { className?: string; style?: React.CSSProperties };

export function AutomatonFrame({
  arrowId,
  className,
  style,
  children,
}: AutomatonProps & { arrowId: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox={AUTOMATON_VIEWBOX}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      // The lines sit a shade under the group opacity the caller sets, and the labels take it
      // in full. Filled text at the same value as a 2px stroke reads fainter than the line
      // does, and the state and transition labels are the part worth being able to make out.
      strokeOpacity="0.9"
    >
      <defs>
        {/* markerUnits defaults to strokeWidth, so this is 10x10 user units at the stroke
            weight above, and its tip lands 2 units past the end of the line it is on. */}
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0 0 10 5 0 10Z" fill="currentColor" stroke="none" />
        </marker>
      </defs>
      {children}
    </svg>
  );
}

/** A state circle and its name, with the double ring when it accepts. */
export function StateNode({
  x,
  y,
  r,
  label,
  accepting = false,
}: {
  x: number;
  y: number;
  r: number;
  label: string;
  accepting?: boolean;
}) {
  return (
    <>
      <circle cx={x} cy={y} r={r} />
      {accepting ? <circle cx={x} cy={y} r={R_ACCEPT_INNER} /> : null}
      <text
        x={x}
        y={y}
        fontSize="18"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        {label}
      </text>
    </>
  );
}

/** A transition's symbol, placed beside its line rather than on it. */
export function EdgeLabel({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <text
      x={x}
      y={y}
      fontSize="15"
      fill="currentColor"
      stroke="none"
      textAnchor="middle"
      dominantBaseline="central"
    >
      {children}
    </text>
  );
}
