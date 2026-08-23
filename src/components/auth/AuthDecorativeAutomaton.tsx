/**
 * A three-state automaton, drawn faintly behind the sign-in panel's copy.
 *
 * Decoration, and deliberately not a diagram: the transitions spell nothing, there is no
 * alphabet worth reading, and it carries no information the page needs. It is here because
 * this is the product it belongs to, and a screen reader should never be told about it.
 *
 * Static. Everything is a stroke on the current colour at low opacity, so it takes the
 * surrounding text colour and costs one inline SVG.
 */
export function AuthDecorativeAutomaton({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 190"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {/* The start arrow. */}
      <path d="M6 118 H32" strokeLinecap="round" />
      <path d="M26 113 32 118 26 123" strokeLinecap="round" strokeLinejoin="round" />

      {/* q0 */}
      <circle cx="54" cy="118" r="22" />
      <text x="54" y="123" fontSize="15" fill="currentColor" stroke="none" textAnchor="middle">
        q0
      </text>

      {/* q0 loops back to itself. */}
      <path d="M40 99a20 20 0 0 1 28 0" strokeLinecap="round" />
      <path d="M62 96 68 99 65 105" strokeLinecap="round" strokeLinejoin="round" />
      <text x="54" y="86" fontSize="13" fill="currentColor" stroke="none" textAnchor="middle">
        a
      </text>

      {/* q0 to q1, the accepting state. */}
      <path d="M74 106C120 74 158 60 202 56" strokeLinecap="round" />
      <path d="M196 51 203 56 197 62" strokeLinecap="round" strokeLinejoin="round" />
      <text x="138" y="75" fontSize="13" fill="currentColor" stroke="none" textAnchor="middle">
        b
      </text>

      {/* q1, accepting: the double ring again. */}
      <circle cx="228" cy="56" r="26" />
      <circle cx="228" cy="56" r="21" />
      <text x="228" y="61" fontSize="15" fill="currentColor" stroke="none" textAnchor="middle">
        q1
      </text>

      {/* q1 down to q2. */}
      <path d="M223 82C218 112 208 132 196 145" strokeLinecap="round" />
      <path d="M199 138 195 146 188 142" strokeLinecap="round" strokeLinejoin="round" />
      <text x="226" y="118" fontSize="13" fill="currentColor" stroke="none" textAnchor="middle">
        a
      </text>

      {/* q2 */}
      <circle cx="168" cy="156" r="22" />
      <text x="168" y="161" fontSize="15" fill="currentColor" stroke="none" textAnchor="middle">
        q2
      </text>

      {/* q2 back to q0, closing the cycle. */}
      <path d="M146 156C118 156 88 148 68 136" strokeLinecap="round" />
      <path d="M75 134 67 136 70 143" strokeLinecap="round" strokeLinejoin="round" />
      <text x="110" y="167" fontSize="13" fill="currentColor" stroke="none" textAnchor="middle">
        b
      </text>
    </svg>
  );
}

export default AuthDecorativeAutomaton;
