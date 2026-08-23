/**
 * A three-state automaton, drawn faintly behind the sign-in panel's copy.
 *
 * Decoration, and deliberately not a diagram: it carries no information the page needs and a
 * screen reader is never told about it. It is drawn properly anyway, because the people who
 * see this page teach the subject and a sloppy automaton is the one thing on the screen they
 * would notice. It reads q0 --b--> q1, q1 --a--> q2, q2 --b--> q0, with a loop on a at q0:
 * one clean cycle, not a complete DFA, which would need edges that only add clutter here.
 *
 * Wide rather than tall (540x270, 2:1). It fills the middle of a panel that is roughly half a
 * screen wide, so the long q0 to q1 transition is what makes the drawing use the space; the
 * earlier version packed the three states into a small triangle and looked cramped however
 * large it was scaled.
 *
 * Static, one inline SVG, no dependency.
 */

/**
 * One marker for every arrowhead, so each one follows its path's own tangent rather than
 * being a separate triangle positioned by eye.
 *
 * A fixed id, not `useId`. This renders once per document (`LoginBrandPanel` is mounted once,
 * on the sign-in page) and a fixed id keeps this a server component. If it is ever placed
 * somewhere it could appear twice, the id has to become unique per instance, which means
 * making this a client component to reach `useId`.
 */
const ARROW_ID = 'afct-auth-automaton-arrow';

export function AuthDecorativeAutomaton({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 540 270"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <defs>
        {/* markerUnits defaults to strokeWidth, so this is 10x10 user units at the stroke
            weight above, and its tip lands 2 units past the end of the path it is on. Every
            transition therefore stops just outside its target circle rather than at the
            centre, and the head touches the boundary without crossing it. */}
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
      <path d="M30 125H78" strokeLinecap="round" markerEnd={`url(#${ARROW_ID})`} />

      {/* q0 */}
      <circle cx="110" cy="125" r="28" />
      <text
        x="110"
        y="125"
        fontSize="18"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        q0
      </text>

      {/* q0 loops back to itself on a. Leaves the top left, rises well clear of the state,
          returns to the top right; the head follows the curve down into the boundary. */}
      <path
        d="M89 104C72 50 148 50 131 104"
        strokeLinecap="round"
        markerEnd={`url(#${ARROW_ID})`}
      />
      <text
        x="110"
        y="44"
        fontSize="15"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        a
      </text>

      {/* q0 to q1, the long one. Barely curved: q1 sits higher, and the lift is enough to
          keep the line from reading as a ruler. */}
      <path
        d="M138 121C220 100 290 88 360 86"
        strokeLinecap="round"
        markerEnd={`url(#${ARROW_ID})`}
      />
      <text
        x="250"
        y="80"
        fontSize="15"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        b
      </text>

      {/* q1, accepting: two rings with real space between them. */}
      <circle cx="395" cy="80" r="32" />
      <circle cx="395" cy="80" r="26" />
      <text
        x="395"
        y="80"
        fontSize="18"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        q1
      </text>

      {/* q1 down to q2, bowing outward so it clears both labels. */}
      <path
        d="M383 110C398 135 390 152 361 166"
        strokeLinecap="round"
        markerEnd={`url(#${ARROW_ID})`}
      />
      <text
        x="415"
        y="140"
        fontSize="15"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        a
      </text>

      {/* q2 */}
      <circle cx="350" cy="195" r="28" />
      <text
        x="350"
        y="195"
        fontSize="18"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        q2
      </text>

      {/* q2 back to q0, closing the cycle through the empty bottom of the frame rather than
          straight across the middle, which is what gives the drawing its shape. */}
      <path
        d="M324 205C270 250 175 240 131 148"
        strokeLinecap="round"
        markerEnd={`url(#${ARROW_ID})`}
      />
      <text
        x="228"
        y="252"
        fontSize="15"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        dominantBaseline="central"
      >
        b
      </text>
    </svg>
  );
}

export default AuthDecorativeAutomaton;
