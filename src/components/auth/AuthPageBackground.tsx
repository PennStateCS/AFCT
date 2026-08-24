import { AuthDecorativeWave } from './AuthDecorativeWave';

/**
 * The branded backdrop every signed-out page shares: sign in, forgot password, choose a new
 * password, change a temporary one.
 *
 * It owns the whole page ground, and it is the only thing that does. The sign-in screen used
 * to paint navy on its left column and leave the right one light, which drew a hard vertical
 * seam down the middle of a page that is meant to read as one surface with two light objects
 * floating on it. Nothing else may set a page background on these routes: a second one behind
 * this is how the seam comes back.
 *
 * Four fixed layers, deliberately quiet: the rail colour, cobalt gathering towards the bottom
 * right, a soft light lifting the top left, and the wave along the foot. `fixed` rather than
 * absolute because a tall signup form scrolls and the ground should not.
 *
 * `w-screen` rather than `inset-0`, which is not a detail. `html` carries
 * `scrollbar-gutter: stable` so page-to-page navigation does not shift sideways, and a fixed
 * element's containing block excludes that reserved gutter: at `inset-0` the ground stopped
 * 15px short of the right edge and the body colour showed through as a pale stripe down the
 * side of the screen. 100vw covers the gutter.
 *
 * The pages that use this pair it with `auth-light`, which pins their cards to the light
 * palette; without it a dark dashboard theme would put a dark card on a dark ground.
 */
export function AuthPageBackground() {
  return (
    <>
      <div
        aria-hidden="true"
        className="bg-sidebar pointer-events-none fixed inset-y-0 left-0 z-0 w-screen"
      />
      <div
        aria-hidden="true"
        className="to-primary/50 pointer-events-none fixed inset-y-0 left-0 z-0 w-screen bg-gradient-to-br from-transparent via-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-y-0 left-0 z-0 w-screen bg-[radial-gradient(ellipse_at_top_left,rgba(96,165,250,0.14),transparent_62%)]"
      />
      {/* Full width now that the ground is. It was the left column's footer decoration; across
          the whole page it reads as the bottom of the screen rather than the bottom of a pane,
          which is the point of removing the seam. The contour lines are one colour, set here
          as `currentColor` so the whole set moves together. */}
      <AuthDecorativeWave className="pointer-events-none fixed bottom-0 left-0 z-0 h-40 w-screen text-blue-400 xl:h-44" />
    </>
  );
}

export default AuthPageBackground;
