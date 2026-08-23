/**
 * The AFCT mark: an accepting state inside a bounded hexagon.
 *
 * Drawn rather than shipped as an image. It appears at 40px on a phone and 64px on the
 * sign-in panel, it has to sit on the dark rail colour without a matte, and the page it is on
 * is the first thing anyone loads. An SVG this small costs less than the request for a PNG
 * would, and it stays sharp at any size.
 *
 * Decorative in every place it is used: the wordmark beside it already says AFCT, so naming
 * it here would make a screen reader say the same thing twice.
 */
export function AuthBrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false" fill="none">
      {/* The bound: a language is a set, and the hexagon is the box round it. */}
      <path
        d="M24 3 42.18 13.5 42.18 34.5 24 45 5.82 34.5 5.82 13.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity="0.5"
      />
      {/* An accepting state, which is what a double ring means everywhere else in AFCT. */}
      <circle cx="24" cy="24" r="10.5" stroke="currentColor" strokeWidth="1.6" opacity="0.75" />
      <circle cx="24" cy="24" r="6.5" fill="currentColor" />
    </svg>
  );
}

export default AuthBrandMark;
