import * as React from 'react';

// Tailwind's `lg`, and the same width at which the global sidebar stops auto-collapsing.
// Below it there is not enough room for a rail beside the sidebar and a table.
const LG = 1024;

/**
 * True once the viewport is wide enough for the course page's vertical navigation rail.
 *
 * Deliberately a hook rather than two CSS-hidden lists: the course tabs emit `tab-*` ids
 * that `CourseTabPanel` points its `aria-labelledby` at, so rendering both a strip and a
 * rail would duplicate every one of those ids. Only one tablist may exist at a time.
 *
 * Modelled on `useIsMobile`, including its first-paint behaviour: this is false until the
 * effect runs, so a desktop load shows the strip for one frame before the rail replaces
 * it. Reading `window.innerWidth` during render would fix the flicker and break hydration
 * instead; the sidebar's auto-collapse makes the same trade.
 */
export function useIsDesktopNav(breakpoint: number = LG) {
  const [isDesktop, setIsDesktop] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    // Guards jsdom / SSR where matchMedia is absent: stays at the false default.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const onChange = () => {
      setIsDesktop(window.innerWidth >= breakpoint);
    };
    mql.addEventListener('change', onChange);
    setIsDesktop(window.innerWidth >= breakpoint);
    return () => mql.removeEventListener('change', onChange);
  }, [breakpoint]);

  return !!isDesktop;
}
