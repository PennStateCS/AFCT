'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The layout and the collapse state behind the shared vertical local-navigation rail
 * (`TabRail` in `components/course/course-tabs.tsx`).
 *
 * Six pages draw the same shape: a fixed rail column beside a `min-w-0` workspace above a
 * breakpoint, and a plain stack below it. That grid template used to be copy-pasted into
 * each of them, which is fine until the rail can change width: the rail would shrink and
 * the column would not, so collapsing it would buy no room at all. The template lives
 * here now, driven by a CSS variable, and the rail reads the same state through context.
 *
 * The state is deliberately NOT the global sidebar's. That one is application chrome and
 * has its own cookie; this is a per-page rail. Two independent controls.
 */

/** Where the preference is remembered. One key, so the choice follows the user between pages. */
export const LOCAL_NAV_COLLAPSED_KEY = 'afct:local-nav-collapsed';

// 15rem gives the rail nearly the presence of the global sidebar while staying clearly
// secondary to it. It was 12rem, sized for a rail that had to justify every pixel it took
// from a wide table; that argument went away when the rail became collapsible, and anyone
// who wants the width back can take all of it rather than the 3rem this costs.
//
// 3.5rem matches the global sidebar's icon rail, so the two collapsed columns share a
// rhythm: 56px centres a size-5 icon in a full-width row with room for its focus ring.
const EXPANDED_WIDTH = '15rem';
const COLLAPSED_WIDTH = '3.5rem';

type LocalNavCollapseValue = {
  collapsed: boolean;
  toggle: () => void;
};

const LocalNavCollapseContext = React.createContext<LocalNavCollapseValue | null>(null);

/**
 * The rail's collapse state, or `null` when it is rendered outside a {@link LocalNavLayout}.
 * A null result means "no collapse affordance": the rail renders expanded with no toggle,
 * because a toggle that cannot move the surrounding column would be a lie.
 */
export function useLocalNavCollapse() {
  return React.useContext(LocalNavCollapseContext);
}

// Two literal strings rather than one built from the prop: a Tailwind class assembled at
// runtime never reaches the compiler and silently does nothing. The variable is what
// changes, so both templates stay static.
//
// grid-template-columns is the animated property (both tracks are lengths, so it
// interpolates), and it is scoped to the breakpoint where the grid exists at all.
const GRID_CLASS = {
  lg: 'lg:grid lg:grid-cols-[var(--local-nav-width)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0 lg:transition-[grid-template-columns] lg:duration-200 lg:ease-in-out lg:motion-reduce:transition-none',
  xl: 'xl:grid xl:grid-cols-[var(--local-nav-width)_minmax(0,1fr)] xl:items-start xl:gap-6 xl:space-y-0 xl:transition-[grid-template-columns] xl:duration-200 xl:ease-in-out xl:motion-reduce:transition-none',
} as const;

/**
 * The rail-plus-workspace layout. Pass the navigation control (the rail above the
 * breakpoint, the strip below it) as `nav`; the workspace is `children`.
 *
 * `breakpoint` must match the width the caller passes to `useIsDesktopNav`, since that is
 * what decides whether `nav` is a rail or a strip.
 */
export function LocalNavLayout({
  breakpoint = 'xl',
  nav,
  className,
  contentClassName,
  children,
}: {
  breakpoint?: 'lg' | 'xl';
  nav: React.ReactNode;
  /** Spacing for the stacked (below-breakpoint) layout. Defaults to `space-y-6`. */
  className?: string;
  /** Extra classes for the workspace column, e.g. a readable `max-w-3xl` measure. */
  contentClassName?: string;
  children: React.ReactNode;
}) {
  // Expanded on the first render, always. The saved preference is read after mount so the
  // server-rendered markup and the first client render agree; a lazy initializer reading
  // localStorage would hydration-mismatch instead.
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(LOCAL_NAV_COLLAPSED_KEY) === 'true');
    } catch {
      // Blocked storage: stay expanded.
    }
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(LOCAL_NAV_COLLAPSED_KEY, String(next));
      } catch {
        // Non-fatal: the toggle still works this session, it just won't persist.
      }
      return next;
    });
  }, []);

  const value = React.useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);

  return (
    <LocalNavCollapseContext.Provider value={value}>
      <div
        className={cn('space-y-6', GRID_CLASS[breakpoint], className)}
        style={
          {
            '--local-nav-width': collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
          } as React.CSSProperties
        }
      >
        {nav}
        <div className={cn('min-w-0', contentClassName)}>{children}</div>
      </div>
    </LocalNavCollapseContext.Provider>
  );
}
