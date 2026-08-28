'use client';

import { useEffect, useState } from 'react';

import type { AuthAutomaton } from '@/lib/auth-automata';
import { cn } from '@/lib/utils';

/**
 * Two and a half minutes, which is long enough that nobody watches it happen.
 *
 * The point of this is that somebody who lingers on the sign-in page eventually notices the
 * diagram is not the one they remember. If it changed every twenty seconds it would be a
 * slideshow, and a slideshow on a login screen is something to close, not something to like.
 */
const ROTATION_MS = 150_000;
const FADE_MS = 1_800;

/**
 * The decorative automaton, quietly swapped every few minutes.
 *
 * The drawings are SVG files in public/auth-automata, read on the server and handed down as
 * markup (see src/lib/auth-automata.ts). They used to be five hand-written components; a folder
 * means the decoration can be changed by someone who does not write React, and that adding a
 * sixth is not a code change.
 *
 * All of them are mounted at once and only their opacity changes, which is what keeps the
 * crossfade free of layout shift: nothing reflows, and the wrapper's height never depends on
 * which diagram is showing. Each one is stacked absolutely and fills the wrapper, whose size
 * the caller sets from the shared aspect ratio; none of them is in flow, so no single diagram
 * can decide how big the others are.
 */
export function RotatingAuthAutomaton({
  automata,
  className,
}: {
  automata: AuthAutomaton[];
  className?: string;
}) {
  const [active, setActive] = useState(0);

  // Not `automata.length` directly: the effect must not re-run because a parent handed down a
  // new array with the same contents, which would restart the countdown on every render.
  const count = automata.length;

  useEffect(() => {
    // Nothing to rotate through. One drawing is a picture, not a rotation.
    if (count < 2) return;

    // Nothing moves for somebody who has asked for nothing to move. Not a shorter fade: the
    // honest reading of the preference is that the decoration should simply be still.
    const motionOk =
      typeof window.matchMedia === 'function'
        ? !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : true;
    if (!motionOk) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      timer ??= setInterval(() => setActive((i) => (i + 1) % count), ROTATION_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    // A background tab should not be advancing a picture nobody is looking at. Coming back
    // restarts the full countdown rather than trying to work out what was missed.
    const onVisibility = () => (document.visibilityState === 'hidden' ? stop() : start());

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [count]);

  // An empty folder is a valid state, and the panel simply has no decoration in it. Rendering
  // the wrapper anyway would leave an empty box holding the space.
  if (count === 0) return null;

  return (
    <div className={cn('relative', className)} aria-hidden="true">
      {automata.map((automaton, index) => (
        <div
          key={automaton.id}
          // The duration is set here rather than as a `duration-[1800ms]` class: Tailwind
          // scans source text, so a class built from a template literal is never generated
          // and the fade would silently fall back to the default 150ms.
          style={{ transitionDuration: `${FADE_MS}ms` }}
          className={cn(
            'absolute inset-0 h-full w-full transition-opacity ease-in-out',
            // The file decides the drawing's shape through its viewBox; this makes its <svg>
            // fill the box the panel set, which is what the drawings-as-components used to do
            // with a className of their own. They are inlined, so they cannot take one.
            '[&>svg]:h-full [&>svg]:w-full',
            index === active ? 'opacity-100' : 'opacity-0',
          )}
          // The files are part of the deployed image and are parsed, checked and had their ids
          // namespaced on the server before they get here; see src/lib/auth-automata.ts. Inlined
          // rather than put in an <img> so a drawing using currentColor still inherits the
          // panel's tint, which is how the decoration stays part of the composition.
          dangerouslySetInnerHTML={{ __html: automaton.markup }}
        />
      ))}
    </div>
  );
}

export default RotatingAuthAutomaton;
