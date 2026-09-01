'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The actions a rendered machine can perform on itself, published to whatever chrome is
 * around it.
 *
 * The export actions belong to the cytoscape instance, which lives inside the viewer, while
 * the menu that offers them belongs to the window. Rather than lift the whole engine or hand
 * the viewer a menu to render, the viewer publishes its actions here and the chrome picks
 * them up. Nothing outside the standalone window provides this context, so the same viewer
 * inside a dialog registers nothing and behaves exactly as before.
 */
export type ViewerActions = {
  // The three exports are async (they rasterise or reach the clipboard). Typed to allow it
  // rather than as `() => void`, because a promise handed to a void-returning slot is a
  // floating promise the linter is right to refuse.
  downloadSVG: () => void | Promise<void>;
  downloadPNG: () => void | Promise<void>;
  copyPNG: () => void | Promise<void>;
  toggleGrid: () => void;
  /** Draw the machine where the author put the states, rather than auto-arranging it. */
  setAsDrawn: () => void;
  /** Let the layout engine place the states. */
  setAutoArranged: () => void;
};

/** View state the chrome needs to render, as opposed to actions it can invoke. */
export type ViewerViewState = {
  /** Whether the grid is currently drawn, so a menu can show it ticked. */
  grid: boolean;
  /** Which layout is showing, so a menu can mark one of the two. */
  layout: 'as-drawn' | 'auto';
};

/**
 * Functions, not a ref.
 *
 * The registry is deliberately a pair of stable callbacks closing over the provider's own
 * ref, rather than the ref itself: reaching into a value returned by `useContext` and
 * assigning to it is exactly what the compiler's immutability rule forbids, and the rule is
 * right. Calling in is fine; writing through is not.
 */
type Registry = {
  register: (actions: ViewerActions | null, view: ViewerViewState | null) => void;
  run: (name: keyof ViewerActions) => void;
};

/**
 * Two contexts. The registry never changes identity, so the effect that depends on it runs
 * on mount and unmount only. Whether a viewer is present does change, so it lives on its
 * own and cannot drag the registry with it.
 */
const ViewerRegistryContext = createContext<Registry | null>(null);
const ViewerViewContext = createContext<{
  ready: boolean;
  grid: boolean;
  layout: ViewerViewState['layout'];
}>({ ready: false, grid: false, layout: 'as-drawn' });

export function ViewerActionsProvider({ children }: { children: React.ReactNode }) {
  const actions = useRef<ViewerActions | null>(null);
  // Only presence is state. The functions themselves stay in the ref, because the viewer
  // rebuilds them on most renders and holding them in state would re-render the menu each
  // time for no gain.
  const [ready, setReady] = useState(false);
  // The grid flag is state, unlike the actions, because a menu has to re-render to show it
  // ticked. It changes only when somebody toggles it, so this costs nothing.
  const [grid, setGrid] = useState(false);
  const [layout, setLayout] = useState<ViewerViewState['layout']>('as-drawn');

  // `useRef` and the `useState` setter are both stable, so this is built once.
  const view = useMemo(() => ({ ready, grid, layout }), [ready, grid, layout]);

  const registry = useMemo<Registry>(
    () => ({
      register: (next, view) => {
        actions.current = next;
        // Both setters bail when the value is unchanged, which is what makes it safe to call
        // this after every render of the viewer.
        setReady(next !== null);
        setGrid(view?.grid ?? false);
        setLayout(view?.layout ?? 'as-drawn');
      },
      // `void`: three of these are async, and their result is nothing the caller waits on.
      run: (name) => {
        void actions.current?.[name]();
      },
    }),
    [],
  );

  return (
    <ViewerRegistryContext.Provider value={registry}>
      <ViewerViewContext.Provider value={view}>{children}</ViewerViewContext.Provider>
    </ViewerRegistryContext.Provider>
  );
}

/**
 * Publish this viewer's actions. A no-op when there is no provider, which is the case in
 * every dialog.
 */
export function useRegisterViewerActions(actions: ViewerActions, view: ViewerViewState): void {
  const registry = useContext(ViewerRegistryContext);

  // After every render, so the menu always calls the current instance's actions and shows
  // its current view state. Setting an unchanged value is a no-op, so this does not loop.
  useEffect(() => {
    registry?.register(actions, view);
  });

  // Withdraw on unmount, so a closed viewer does not leave the menu offering actions that
  // would run against a torn-down graph.
  useEffect(() => {
    return () => registry?.register(null, null);
  }, [registry]);
}

/** What the chrome can offer right now. */
export function useViewerActions(): {
  ready: boolean;
  grid: boolean;
  layout: ViewerViewState['layout'];
  run: (name: keyof ViewerActions) => void;
} {
  const registry = useContext(ViewerRegistryContext);
  const { ready, grid, layout } = useContext(ViewerViewContext);
  const run = registry?.run;
  return { ready, grid, layout, run: (name) => run?.(name) };
}
