import * as React from 'react';

/**
 * True when the primary input can hover, which in practice means a mouse or trackpad
 * rather than a finger.
 *
 * This asks about hover rather than screen size on purpose. Radix's select focuses the
 * item under the pointer as it moves, so with a mouse the focused item is always the one
 * you are looking at. A finger never hovers, so focus stays wherever it was when the list
 * opened, and anything that scrolls the focused item back into view drags the list with
 * it. See the scroll buttons in `components/ui/select.tsx`.
 *
 * Modelled on `useIsMobile`, including its first-paint behaviour: false until the effect
 * runs, so the server render and the first client render agree.
 */
export function useCanHover() {
  const [canHover, setCanHover] = React.useState(false);

  React.useEffect(() => {
    // Guards jsdom / SSR where matchMedia is absent: stays at the false default.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(hover: hover) and (pointer: fine)');
    const onChange = () => setCanHover(mql.matches);
    mql.addEventListener('change', onChange);
    setCanHover(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return canHover;
}
