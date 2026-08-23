import { cn } from '@/lib/utils';

/**
 * The AFCT mark: a small automaton inside a bounded hexagon.
 *
 * Drawn rather than shipped as an image. It appears at 48px on a phone and 80px on the
 * sign-in panel, it has to sit on the dark rail colour without a matte, and the page it is on
 * is the first thing anyone loads. An SVG this small costs less than the request for a PNG
 * would, and it stays sharp at any size.
 *
 * Two colours, and both come from the caller. The frame and the accepting state take
 * `currentColor`; the ordinary states and the transitions take whatever `accentClassName`
 * sets, picked up as `currentColor` inside their own group. That indirection is the point:
 * the same component sits on the near-black brand panel and on a white card, so a literal
 * second colour would be invisible on one of them. On the panel the accent goes near-white,
 * on the card it goes navy, and the drawing reads the same way on both.
 *
 * Decorative in every place it is used: the wordmark beside it already says AFCT, so naming
 * it here would make a screen reader say the same thing twice.
 */
export function AuthBrandMark({
  className,
  accentClassName,
}: {
  className?: string;
  accentClassName?: string;
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
      {/* The bound: a language is a set, and the hexagon is the box round it. */}
      <path d="M32 2 57.98 17 57.98 47 32 62 6.02 47 6.02 17Z" strokeWidth="2.3" />

      {/* Two ordinary states and the transitions between them, in the second colour. */}
      <g className={cn('text-current', accentClassName)} strokeWidth="2">
        <circle cx="19" cy="24.5" r="4.8" />
        <circle cx="30" cy="46" r="4.8" />
        {/* Down and along, with the corner rounded off: the long way round to the state the
            arrow reaches directly. */}
        <path d="M19 29.3V40q0 6 6.2 6" />
        <path d="M39.4 30.5 32.5 41.9" />
        <path d="M23.8 24.5H30.2" />
        {/* The one transition with an arrowhead, drawn rather than marked: a marker needs an
            id, and both the panel and the phone header have one of these in the document at
            the same time. One fixed triangle has no id to collide. */}
        <path d="M29.8 21.1 36 24.5 29.8 27.9Z" fill="currentColor" stroke="none" />
      </g>

      {/* Accepting, which is what a double ring means everywhere else in AFCT. */}
      <circle cx="43" cy="24.5" r="7" strokeWidth="2.2" />
      <circle cx="43" cy="24.5" r="3.4" strokeWidth="2" />
    </svg>
  );
}

export default AuthBrandMark;
