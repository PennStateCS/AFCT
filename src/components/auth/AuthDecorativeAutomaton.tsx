/**
 * A three-state automaton, drawn faintly behind the sign-in panel's copy.
 *
 * Decoration, and deliberately not a diagram: it carries no information the page needs and a
 * screen reader is never told about it. It is drawn properly anyway, because the people who
 * see this page teach the subject and a sloppy automaton is the one thing on the screen they
 * would notice. It reads q0 --b--> q1, q1 --a--> q2, q2 --b--> q0, with a loop on a at q0:
 * one clean cycle, not a complete DFA, which would need edges that only add clutter here.
 *
 * Straight edges between states and a curve only where a state points at itself, which is
 * JFLAP's convention and therefore what the audience for this page is used to reading.
 *
 * Wide rather than tall (444x234, 1.9:1). It fills the middle of a panel that is roughly half
 * a screen wide, so the long q0 to q1 edge is what makes the drawing use the space.
 *
 * The frame is drawn around the ink rather than chosen first: roughly 22 units of margin on
 * every side. It used to be 540x270, sized for a sweeping return curve that filled the bottom
 * right; once that edge was straightened, 113 units of the width and 47 of the height were
 * empty, and since the box centres in its row and the drawing did not centre in the box, the
 * whole automaton sat about 55px left of where it looked like it should.
 *
 * Static, one inline SVG, no dependency.
 */

type State = { x: number; y: number; r: number };

/** The three states, in one place, because every edge below is derived from them. */
const Q0: State = { x: 103, y: 112, r: 28 };
const Q1: State = { x: 388, y: 67, r: 32 };
const Q2: State = { x: 343, y: 182, r: 28 };
/** q1 is accepting, so it carries a second ring inside the one the edges stop at. */
const Q1_INNER = 26;

/**
 * The visible part of the line between two states: from the first circle's edge to just
 * outside the second's, never centre to centre.
 *
 * `endInset` is the room the arrowhead needs. The marker's tip sits two user units past the
 * end of the line it is on, so three units of inset puts the point on the boundary rather
 * than inside the state.
 *
 * Computed rather than written down so the geometry stays right if a state ever moves. It is
 * three lines of trigonometry, not the beginning of a layout engine.
 */
function edgeBetween(from: State, to: State, endInset = 3) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const round = (n: number) => Math.round(n * 10) / 10;
  const x1 = from.x + ux * from.r;
  const y1 = from.y + uy * from.r;
  const x2 = to.x - ux * (to.r + endInset);
  const y2 = to.y - uy * (to.r + endInset);
  return {
    /** Spread straight onto a <line>; nothing else in here belongs on the element. */
    line: { x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2) },
    /**
     * A point `offset` units off the middle of the edge, at right angles to it. The sign
     * picks the side, so a label is always placed against its own line rather than at a
     * coordinate that happens to look right today.
     */
    labelAt: (offset: number) => ({
      x: round((x1 + x2) / 2 - uy * offset),
      y: round((y1 + y2) / 2 + ux * offset),
    }),
  };
}

/** Far enough off the line that the glyph never touches the stroke. */
const LABEL_OFFSET = -17;

/**
 * One marker for every arrowhead, so each one follows its own edge's direction rather than
 * being a separate triangle positioned by eye.
 *
 * A fixed id, not `useId`. This renders once per document (`LoginBrandPanel` is mounted once,
 * on the sign-in page) and a fixed id keeps this a server component. If it is ever placed
 * somewhere it could appear twice, the id has to become unique per instance, which means
 * making this a client component to reach `useId`.
 */
const ARROW_ID = 'afct-auth-automaton-arrow';

const toQ1 = edgeBetween(Q0, Q1);
const toQ2 = edgeBetween(Q1, Q2);
const toQ0 = edgeBetween(Q2, Q0);

export function AuthDecorativeAutomaton({ className }: { className?: string }) {
  const labelToQ1 = toQ1.labelAt(LABEL_OFFSET);
  const labelToQ2 = toQ2.labelAt(LABEL_OFFSET);
  const labelToQ0 = toQ0.labelAt(LABEL_OFFSET);

  return (
    <svg
      viewBox="0 0 444 234"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      // The lines sit a shade under the group opacity the caller sets, and the labels take it
      // in full. Filled text at the same value as a 2px stroke reads fainter than the line
      // does, and q0/q1/a/b are the part worth being able to make out.
      strokeOpacity="0.9"
    >
      <defs>
        {/* markerUnits defaults to strokeWidth, so this is 10x10 user units at the stroke
            weight above, and its tip lands 2 units past the end of the line it is on. */}
        <marker
          id={ARROW_ID}
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

      {/* Start indicator, into q0's left edge. */}
      <line x1="23" y1={Q0.y} x2={Q0.x - Q0.r - 4} y2={Q0.y} markerEnd={`url(#${ARROW_ID})`} />

      {/* q0 loops back to itself on a. The one curve in the drawing, because a straight line
          from a state to itself is not a thing anybody draws. */}
      <path d="M82 91C65 37 141 37 124 91" strokeLinecap="round" markerEnd={`url(#${ARROW_ID})`} />
      <text
        x={Q0.x}
        y="31"
        fontSize="15"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        a
      </text>

      {/* q0 --b--> q1, the long one. */}
      <line {...toQ1.line} markerEnd={`url(#${ARROW_ID})`} />
      <text
        x={labelToQ1.x}
        y={labelToQ1.y}
        fontSize="15"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        b
      </text>

      {/* q1 --a--> q2 */}
      <line {...toQ2.line} markerEnd={`url(#${ARROW_ID})`} />
      <text
        x={labelToQ2.x}
        y={labelToQ2.y}
        fontSize="15"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        a
      </text>

      {/* q2 --b--> q0, closing the cycle. */}
      <line {...toQ0.line} markerEnd={`url(#${ARROW_ID})`} />
      <text
        x={labelToQ0.x}
        y={labelToQ0.y}
        fontSize="15"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        b
      </text>

      {/* The states last, so a circle always paints over the end of the line meeting it. */}
      <circle cx={Q0.x} cy={Q0.y} r={Q0.r} />
      <text
        x={Q0.x}
        y={Q0.y}
        fontSize="18"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        q0
      </text>

      <circle cx={Q1.x} cy={Q1.y} r={Q1.r} />
      <circle cx={Q1.x} cy={Q1.y} r={Q1_INNER} />
      <text
        x={Q1.x}
        y={Q1.y}
        fontSize="18"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        q1
      </text>

      <circle cx={Q2.x} cy={Q2.y} r={Q2.r} />
      <text
        x={Q2.x}
        y={Q2.y}
        fontSize="18"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        q2
      </text>
    </svg>
  );
}

export default AuthDecorativeAutomaton;
