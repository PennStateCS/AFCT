import { Code2 } from 'lucide-react';

import { AuthBrandMark } from './AuthBrandMark';
import { AuthDecorativeAutomaton } from './AuthDecorativeAutomaton';
import { AuthDecorativeWave } from './AuthDecorativeWave';
import { cn } from '@/lib/utils';

/** Quiet at rest, underlined on hover: four links should not read as four buttons. */
const FOOTER_LINK = 'hover:text-sidebar-foreground underline-offset-2 hover:underline';

/**
 * The dark half of the sign-in screen.
 *
 * It uses the sidebar's token family rather than a palette of its own, which is the whole
 * point: this is the first thing anyone sees of AFCT, and it should be recognisably the same
 * application as the rail they will be looking at a second later. Those tokens are written for
 * light text on a dark surface in every theme, so nothing here needs a dark: variant.
 *
 * Three rows rather than `justify-between`, which is the composition decision here. Pushing an
 * identity block to the top and a footer to the bottom leaves whatever is left as a hole in the
 * middle, and at 1080px that hole was most of the panel. The middle row is the flexible one and
 * the automaton lives in it, so the empty space is distributed around a subject instead of
 * being the subject.
 *
 * Everything decorative is `aria-hidden` and behind the copy. Hidden below the split
 * breakpoint entirely: a phone gets the compact brand header in `LoginForm` instead, because
 * half of this squeezed into a narrow column is neither the picture nor the form.
 */
export function LoginBrandPanel({ className }: { className?: string }) {
  return (
    <section
      aria-label="About AFCT"
      className={cn(
        'bg-sidebar text-sidebar-foreground relative overflow-hidden',
        // Sticky rather than its own scroller. Signup is taller than the viewport, and two
        // independently scrolling panes is the layout that always ends up trapping a scroll.
        'grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto]',
        // The lg step is set by a 1366x768 laptop, where the panel is under 500px wide and
        // there is no spare height; xl and up get the more generous treatment.
        'p-8 xl:p-12 2xl:p-14',
        className,
      )}
    >
      {/* Depth, in two restrained layers: cobalt gathering towards the bottom right, and a
          soft light lifting the top left. Both derived from the theme rather than picked. */}
      <div
        aria-hidden="true"
        className="to-primary/50 pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(96,165,250,0.14),transparent_62%)]"
      />

      {/* The wave along the foot, behind everything that carries words. */}
      <AuthDecorativeWave className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full xl:h-44" />

      <div className="relative max-w-xl">
        <div className="flex items-center gap-4">
          {/* Cobalt, set here rather than in the mark: the same component is the compact
              header on a phone, where it sits on a light card and takes the primary colour. */}
          <AuthBrandMark className="size-12 shrink-0 text-blue-400 xl:size-14" />
          <div>
            <p className="text-4xl leading-none font-semibold tracking-tight xl:text-5xl 2xl:text-6xl">
              AFCT
            </p>
            <p className="mt-2 text-xs font-medium tracking-[0.32em] text-blue-300 uppercase xl:text-sm 2xl:text-base">
              Dashboard
            </p>
          </div>
        </div>

        {/* The only rule on the panel, and it runs the width of the brand above it: from the
            mark's left edge to the right of the T in AFCT, so the two read as one block
            rather than as a mark with a dash under it.

            Three measured widths rather than one, because AFCT steps 36px -> 48px -> 60px
            across the breakpoints, and rather than the width of the block above, because
            that block is sized by the tracked DASHBOARD, which is WIDER than AFCT below 2xl
            (111 vs 90 at lg). Taking the block's width put the rule 21px past the T.
            mark + gap + AFCT measures 154 / 192 / 223; these land within 2px of each.

            Blue rather than the primary token: it belongs to the same cobalt family as the
            mark and the DASHBOARD line, not to the app's buttons. */}
        <div
          aria-hidden="true"
          className="mt-10 h-0.5 w-38 rounded-full bg-blue-400/80 xl:w-48 2xl:w-56"
        />

        <div className="mt-6 space-y-3">
          <p className="text-xl font-semibold tracking-tight xl:text-2xl 2xl:text-3xl">
            Welcome to AFCT Dashboard
          </p>
          {/* Three weights, on purpose: white heading, blue subtitle, muted body. Flat, they
              read as one paragraph in three pieces. */}
          <p className="text-base text-blue-300 xl:text-lg">
            Automated Feedback for Computing Theory
          </p>
          <p className="text-sidebar-muted-foreground max-w-md text-sm leading-relaxed xl:text-base">
            Deliver intelligent feedback, streamline grading, and support student learning in
            computing theory.
          </p>
        </div>
      </div>

      {/* The middle row, and the reason the panel is a grid. The automaton takes whatever
          height is left between the copy and the footer and centres in it, so the same markup
          is a comfortable composition on a 768px laptop and on a 1440px display.
          Nudged up a notch off dead centre: there is more usable air above it than below,
          where the wave is already occupying the bottom of the frame. */}
      <div className="relative flex min-h-0 items-center justify-center">
        <AuthDecorativeAutomaton className="pointer-events-none h-auto max-h-full w-[30rem] max-w-[96%] -translate-y-4 text-blue-300 opacity-[0.22] xl:w-[35rem] 2xl:w-[40rem]" />
      </div>

      {/* In flow and after the wave, so it paints over it rather than needing a scrim. */}
      <div className="text-sidebar-muted-foreground relative flex flex-wrap items-center gap-x-3 gap-y-2 text-xs xl:gap-x-4 xl:text-sm">
        <span className="flex items-center gap-2">
          <Code2 className="size-4 text-blue-400" aria-hidden="true" />
          Open source
        </span>
        <span aria-hidden="true">&middot;</span>
        <a href="https://www.gnu.org/licenses/agpl-3.0.html" className={FOOTER_LINK}>
          AGPLv3
        </a>
        <span aria-hidden="true">&middot;</span>
        <a href="https://pennstatecs.github.io/AFCT/" className={FOOTER_LINK}>
          Documentation
        </a>
        <span aria-hidden="true">&middot;</span>
        <a href="https://github.com/PennStateCS/AFCT" className={FOOTER_LINK}>
          GitHub
        </a>
      </div>
    </section>
  );
}

export default LoginBrandPanel;
