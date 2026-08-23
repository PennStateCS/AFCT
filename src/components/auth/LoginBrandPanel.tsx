import { Code2 } from 'lucide-react';

import { AuthBrandMark } from './AuthBrandMark';
import { AuthDecorativeAutomaton } from './AuthDecorativeAutomaton';
import { cn } from '@/lib/utils';

/**
 * The dark half of the sign-in screen.
 *
 * It uses the sidebar's token family rather than a palette of its own, which is the whole
 * point: this is the first thing anyone sees of AFCT, and it should be recognisably the same
 * application as the rail they will be looking at a second later. Those tokens are written for
 * light text on a dark surface in every theme, so nothing here needs a dark: variant.
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
        'flex h-dvh flex-col justify-between p-10 xl:p-14',
        className,
      )}
    >
      {/* Depth, in two restrained layers: cobalt gathering towards the bottom right, and a
          soft light lifting the top left. Both derived from the theme rather than picked. */}
      <div
        aria-hidden="true"
        className="to-primary/40 pointer-events-none absolute inset-0 bg-gradient-to-br from-transparent via-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(96,165,250,0.14),transparent_62%)]"
      />

      {/* The automaton sits behind the copy, low enough not to compete with it. */}
      <AuthDecorativeAutomaton className="text-primary-foreground pointer-events-none absolute right-4 bottom-36 w-[26rem] max-w-[70%] opacity-[0.16] xl:right-10" />

      {/* The wave along the foot. Stretched deliberately: it is a texture, not a chart. */}
      <svg
        viewBox="0 0 600 150"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-36 w-full"
        fill="none"
      >
        <path
          d="M0 96C86 44 168 132 258 96S438 30 522 76 600 108 600 108"
          stroke="#60A5FA"
          strokeOpacity="0.30"
          strokeWidth="1.5"
        />
        <path
          d="M0 116C90 66 170 150 262 114S444 52 528 96 600 126 600 126"
          stroke="#3B82F6"
          strokeOpacity="0.24"
          strokeWidth="1.5"
        />
        <path
          d="M0 136C94 90 174 168 268 132S450 76 534 118 600 144 600 144"
          stroke="#2563EB"
          strokeOpacity="0.30"
          strokeWidth="2"
        />
        <path
          d="M0 106C88 54 170 142 260 106S442 40 526 86 600 118 600 118"
          stroke="#93C5FD"
          strokeOpacity="0.30"
          strokeWidth="1.5"
          strokeDasharray="1 9"
          strokeLinecap="round"
        />
      </svg>

      <div className="relative max-w-xl">
        <div className="flex items-center gap-4">
          <AuthBrandMark className="text-primary-foreground size-14 shrink-0" />
          <div>
            <p className="text-5xl leading-none font-semibold tracking-tight xl:text-6xl">AFCT</p>
            <p className="mt-2 text-sm font-medium tracking-[0.32em] text-blue-300 uppercase xl:text-base">
              Dashboard
            </p>
          </div>
        </div>

        <div className="mt-14 space-y-3">
          <p className="text-2xl font-semibold tracking-tight xl:text-3xl">
            Welcome to AFCT Dashboard
          </p>
          <p className="text-sidebar-muted-foreground text-lg">
            Automated Feedback for Computing Theory
          </p>
          <p className="text-sidebar-muted-foreground max-w-md text-base">
            Deliver intelligent feedback, streamline grading, and support student learning in
            computing theory.
          </p>
        </div>
      </div>

      <div className="text-sidebar-muted-foreground relative flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <Code2 className="size-4 text-blue-400" aria-hidden="true" />
          Open source
        </span>
        <span aria-hidden="true">&middot;</span>
        <a
          href="https://www.gnu.org/licenses/agpl-3.0.html"
          className="hover:text-sidebar-foreground underline decoration-1 underline-offset-2"
        >
          AGPLv3
        </a>
        <span aria-hidden="true">&middot;</span>
        <a
          href="https://pennstatecs.github.io/AFCT/"
          className="hover:text-sidebar-foreground underline decoration-1 underline-offset-2"
        >
          Documentation
        </a>
        <span aria-hidden="true">&middot;</span>
        <a
          href="https://github.com/PennStateCS/AFCT"
          className="hover:text-sidebar-foreground underline decoration-1 underline-offset-2"
        >
          GitHub
        </a>
      </div>
    </section>
  );
}

export default LoginBrandPanel;
