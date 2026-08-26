import { cn } from '@/lib/utils';

/** The hexagon, as one constant, so the frame and the optional fill below cannot drift apart. */
const HEX_PATH = 'M32 2 57.98 17 57.98 47 32 62 6.02 47 6.02 17Z';

/**
 * The AFCT mark: a three-state automaton inside a bounded hexagon.
 *
 * Drawn rather than shipped as an image. It appears at 48px on a phone and 80px on the
 * sign-in panel, it has to sit on the dark rail colour without a matte, and the page it is on
 * is the first thing anyone loads. An SVG this small costs less than the request for a PNG
 * would, and it stays sharp at any size.
 *
 * The composition is the triangle DFA, the three-state cycle every automata course draws for
 * counting modulo three. The three states sit on rays from the hexagon's centre toward three
 * alternating vertices, all at the same distance, so they form an inverted equilateral
 * triangle whose centroid is the hexagon's own centre. That construction is what balances the
 * drawing: each state ends up as far from its nearest edges as the others are, which centring
 * a bounding box cannot do in a frame that narrows toward its points. The accepting state
 * takes the bottom apex, the singular position, and fills what would otherwise be the largest
 * patch of dead space.
 *
 * Two colours, and both come from the caller. The frame and the accepting state take
 * `currentColor`; the ordinary states and the transitions take whatever `accentClassName`
 * sets, picked up as `currentColor` inside their own group. That indirection is the point:
 * the same component sits on the near-black brand panel and on a white card, so a literal
 * second colour would be invisible on one of them.
 *
 * The interior is open by default, which is right on a plain surface and wrong on a patterned
 * one: on the dashboard's welcome panel the node network ran straight through the hexagon and
 * the mark stopped reading as an object. `backdropClassName` fills the frame with a third
 * caller-supplied colour to close it. Left unset, nothing is drawn and the mark is unchanged.
 *
 * Decorative in every place it is used: the wordmark beside it already says AFCT, so naming
 * it here would make a screen reader say the same thing twice.
 */
export function AuthBrandMark({
  className,
  accentClassName,
  backdropClassName,
}: {
  className?: string;
  accentClassName?: string;
  /** Fills the hexagon so a patterned surface cannot show through it. Off unless set. */
  backdropClassName?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Behind everything, and only when the caller asks for it: see backdropClassName. */}
      {backdropClassName ? (
        <path d={HEX_PATH} className={backdropClassName} fill="currentColor" stroke="none" />
      ) : null}

      {/* The bound: a language is a set, and the hexagon is the box round it. */}
      <path d={HEX_PATH} strokeWidth="2.3" />

      {/* Ordinary states and transitions, in the second colour. State centres are 15 units
          from the hexagon's centre along the vertex rays; that leaves the states 6.6 units
          clear of their nearest edges and the larger ring 5.1, near enough equal that the
          drawing reads as filling the frame evenly. Transitions are a step lighter than the
          state outlines so the nodes stay dominant at 48px, where everything is only three
          quarters of these numbers. */}
      <g className={cn('text-current', accentClassName)} strokeWidth="1.8">
        <circle cx="19.01" cy="24.5" r="4.2" strokeWidth="2.1" />
        <circle cx="44.99" cy="24.5" r="4.2" strokeWidth="2.1" />
        {/* A cycle, and all three transitions carry a head: a transition has a direction, and
            the people who see this page teach that. Reading round, the left state goes to the
            right state, the right state goes to the accepting one, and the accepting one goes
            back to the left.

            There is deliberately no start arrow and no symbol on any edge. A mark this size
            cannot carry a legible label, so it cannot be a complete machine whatever else is
            added; it is a glyph that reads as an automaton, and the five diagrams on the panel
            beside it are where an actual language is drawn.

            Each line starts on its source's outline rather than at its centre, so the round
            cap merges into the circle stroke, and each head stops 0.4 short of its target's
            outline so it points at the state without touching it. Heads are one size
            throughout (4.4 long, 3.6 across) because three different ones would read as three
            different kinds of transition. */}
        <path d="M24.26 24.5H34.94" />
        <path d="M34.94 22.7 39.34 24.5 34.94 26.3Z" fill="currentColor" stroke="none" />

        <path d="M42.37 29.05 37.78 37" />
        <path d="M36.22 36.1 35.58 40.81 39.33 37.9Z" fill="currentColor" stroke="none" />

        <path d="M28.63 41.16 24.04 33.2" />
        <path d="M25.59 32.3 21.84 29.39 22.48 34.1Z" fill="currentColor" stroke="none" />
      </g>

      {/* Accepting, the double ring it means everywhere else in AFCT. Lighter strokes than the
          states because two concentric circles carry enough weight already, and a full 1.4
          units of daylight between the rings: any less and the pair collapses into one heavy
          dot at 48px. */}
      <circle cx="32" cy="47" r="5.9" strokeWidth="1.7" />
      <circle cx="32" cy="47" r="3" strokeWidth="1.3" />
    </svg>
  );
}

export default AuthBrandMark;
