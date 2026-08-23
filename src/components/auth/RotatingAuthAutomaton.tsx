'use client';

import { useEffect, useState } from 'react';

import { AuthAutomatonOne } from './automata/AuthAutomatonOne';
import { AuthAutomatonTwo } from './automata/AuthAutomatonTwo';
import { AuthAutomatonThree } from './automata/AuthAutomatonThree';
import { AuthAutomatonFour } from './automata/AuthAutomatonFour';
import { AuthAutomatonFive } from './automata/AuthAutomatonFive';
import { cn } from '@/lib/utils';

const AUTOMATA = [
  AuthAutomatonOne,
  AuthAutomatonTwo,
  AuthAutomatonThree,
  AuthAutomatonFour,
  AuthAutomatonFive,
];

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
 * All five are mounted at once and only their opacity changes, which is what keeps the
 * crossfade free of layout shift: nothing reflows, and the wrapper's height never depends on
 * which diagram is showing. All five are stacked absolutely and fill the wrapper, whose size
 * the caller sets from the shared aspect ratio; none of them is in flow, so no single diagram
 * can decide how big the others are.
 *
 * The client boundary stops here. `LoginBrandPanel` and the five drawings are all server
 * components; only the timer needs to be on the client.
 */
export function RotatingAuthAutomaton({ className }: { className?: string }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    // Nothing moves for somebody who has asked for nothing to move. Not a shorter fade: the
    // honest reading of the preference is that the decoration should simply be still.
    const motionOk =
      typeof window.matchMedia === 'function'
        ? !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : true;
    if (!motionOk) return;

    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      timer ??= setInterval(() => setActive((i) => (i + 1) % AUTOMATA.length), ROTATION_MS);
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
  }, []);

  return (
    <div className={cn('relative', className)}>
      {AUTOMATA.map((Automaton, index) => (
        <Automaton
          key={index}
          // The duration is set here rather than as a `duration-[1800ms]` class: Tailwind
          // scans source text, so a class built from a template literal is never generated
          // and the fade would silently fall back to the default 150ms.
          style={{ transitionDuration: `${FADE_MS}ms` }}
          className={cn(
            'absolute inset-0 h-full w-full transition-opacity ease-in-out',
            index === active ? 'opacity-100' : 'opacity-0',
          )}
        />
      ))}
    </div>
  );
}

export default RotatingAuthAutomaton;
