/**
 * The flowing lines along the foot of the sign-in panel.
 *
 * Depth here comes from the number of passes and how faint most of them are, not from
 * brightness: six thin curves at 10% to 30%, one of them dotted, over the panel's own navy.
 * Turning any single line up reads as a graph drawn on the page rather than as texture.
 *
 * Stretched with `preserveAspectRatio="none"` on purpose. The curves mean nothing, so
 * distorting them to whatever width the panel has costs nothing and avoids either tiling or
 * cropping. Static, which is also what a reduced-motion preference would have asked for.
 */
export function AuthDecorativeWave({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 600 150"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
    >
      <path
        d="M0 60C88 12 168 100 258 62S438 0 522 44 600 74 600 74"
        stroke="#93C5FD"
        strokeOpacity="0.10"
        strokeWidth="1.5"
      />
      <path
        d="M0 82C86 32 168 120 258 84S438 20 522 64 600 96 600 96"
        stroke="#60A5FA"
        strokeOpacity="0.16"
        strokeWidth="1.5"
      />
      <path
        d="M0 100C86 48 168 136 258 100S438 34 522 80 600 112 600 112"
        stroke="#60A5FA"
        strokeOpacity="0.30"
        strokeWidth="1.5"
      />
      <path
        d="M0 118C90 68 170 152 262 116S444 54 528 98 600 128 600 128"
        stroke="#3B82F6"
        strokeOpacity="0.22"
        strokeWidth="1.5"
      />
      <path
        d="M0 138C94 92 174 170 268 134S450 78 534 120 600 146 600 146"
        stroke="#2563EB"
        strokeOpacity="0.20"
        strokeWidth="2"
      />
      <path
        d="M0 110C88 58 170 146 260 110S442 44 526 90 600 122 600 122"
        stroke="#93C5FD"
        strokeOpacity="0.28"
        strokeWidth="1.5"
        strokeDasharray="1 9"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default AuthDecorativeWave;
