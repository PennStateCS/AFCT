import { AuthBrandMark } from '@/components/auth/AuthBrandMark';
import { IdentityNetwork } from '@/components/IdentityNetwork';

/**
 * The panel the dashboard opens with: who you are and what is waiting for you.
 *
 * Presentation only. Every value it shows is worked out by the page, which already has the
 * roster and assignment rows in hand, so this adds no query, no client state and no hook. It
 * stays a server component for that reason.
 *
 * Built from the course banner's parts rather than from a palette of its own: the same
 * `--course-banner-*` tokens, the same `IdentityNetwork`, the same radius and border. It is
 * NOT `IdentityPanel`, though, and that is deliberate. That primitive identifies one object you
 * navigated to, with a shell sized for a title over a metadata row; this greets a person, is
 * taller, leads with the mark rather than an object icon, and puts a glow behind it. Sharing the
 * tokens and the network is what makes it the same family. Sharing the shell would have meant
 * bending the shell.
 *
 * This started as a pale blue card. Dark reads better here for the reason it does on a course
 * page: the panel is the first thing on the page and the only branded surface in a column of
 * white cards, so it should be what the eye lands on rather than another card with a tint.
 *
 * The greeting is the page's h1. It replaced an sr-only "Dashboard" heading, so this is the one
 * place the page is named.
 */
export function WelcomePanel({
  firstName,
  courseSummary,
  assignmentSummary,
}: {
  /** Already resolved and already allowed to be empty; see the note in the dashboard page. */
  firstName: string;
  /** Pluralised by the page, which is where the counts are. */
  courseSummary: string;
  assignmentSummary: string;
}) {
  return (
    // mb-6 rather than a space-y on the parent, so the launch notice below keeps the one margin
    // it already carries. overflow-hidden clips the network to the rounded corners.
    <section
      className={
        'border-course-banner-border text-course-banner-foreground relative mb-6 ' +
        'overflow-hidden rounded-xl border bg-gradient-to-r shadow-xs ' +
        'from-course-banner via-course-banner-mid to-course-banner-accent'
      }
    >
      <IdentityNetwork />

      {/* Taller than a course banner on purpose. That one is chrome above a workspace and every
          pixel it takes is a pixel off the table underneath; this is the whole top of the
          dashboard and the only thing above the Courses card, so it can afford the room. min-h,
          not h: a long name wraps the greeting and the panel grows with it. */}
      <div className="relative flex items-center gap-5 p-5 sm:min-h-44 sm:gap-7 sm:p-6 lg:px-8">
        {/*
          The AFCT mark with a glow behind it.

          A radial-gradient circle rather than a blur filter or a drop shadow: this renders on
          every dashboard load, and a filter costs an offscreen pass to say what a gradient says
          for free. It is `--course-banner-glow`, the same light blue the network's highlight
          nodes take, which also means the high-contrast theme switches the glow off along with
          everything else decorative, since that theme sets the token to transparent.

          The glow is a child of the mark's own box, so it stays centred on the mark whatever the
          padding does at different widths.

          Cobalt frame, near-white states: the sign-in page's and the sidebar's pairing for a dark
          surface, set here rather than inside the mark because the same component draws in navy
          on the light mobile header. Decorative, since the greeting beside it names the page and
          the sidebar has already said AFCT.
        */}
        <span className="relative flex shrink-0 items-center justify-center">
          {/* Two gradients, not one, and that is what makes it read as neon rather than as a
              smudge. A single soft circle is a fog; a tube glowing has a bright, tight core that
              falls off fast and a wide dim bloom behind it, so this is one of each: 11rem at a
              fifth opacity for the bloom, 6rem at nearly half for the core. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-44 rounded-full bg-[radial-gradient(circle,var(--course-banner-glow),transparent_65%)] opacity-20"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-24 rounded-full bg-[radial-gradient(circle,var(--course-banner-glow),transparent_60%)] opacity-45"
          />
          <AuthBrandMark
            // The third layer: the mark's own silhouette glowing. One small drop-shadow on one
            // 80px element, which is the single most effective neon cue and the one place a
            // filter earns its cost here (unlike putting one on forty network nodes). Written
            // with the glow TOKEN rather than a literal rgba so the high-contrast theme, which
            // sets that token to transparent, switches the halo off along with the two gradients
            // above it.
            className="relative size-16 text-blue-300 drop-shadow-[0_0_10px_var(--course-banner-glow)] sm:size-20"
            accentClassName="text-course-banner-foreground"
            // Closed rather than open, so the node network does not run through the middle of
            // the mark. The dark end of the panel's own gradient, which is what sits behind the
            // mark at this end anyway, so the fill reads as the hexagon holding the surface
            // rather than as a plate laid on top of it. It also gives the glow behind something
            // to ring, which is the effect the whole thing is for.
            backdropClassName="text-course-banner"
          />
        </span>

        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words lg:text-3xl">
            {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
          </h1>
          {/* One line where it fits, wrapping where it does not. Left uniformly muted rather
              than emphasising the counts: pulling the numbers out would mean rebuilding the two
              summary strings the page composes, and the page is where the counts belong. */}
          <p className="text-course-banner-muted-foreground mt-1.5 text-base">
            {courseSummary} &middot; {assignmentSummary}
          </p>
        </div>
      </div>
    </section>
  );
}

export default WelcomePanel;
