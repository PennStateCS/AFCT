import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { VisibilityState } from '@tanstack/react-table';

/**
 * Column-visibility state persisted to localStorage under `storageKey`, hydrated from a
 * `defaultColumnVisibility` baseline. Returns the state, its setter, and a reset that
 * both restores the defaults and clears the saved value.
 *
 * `defaultColumnVisibility` is only the hydration baseline; it is deliberately NOT a
 * hydration dependency, so a parent passing a fresh object each render can't re-run the
 * load effect and clobber the user's column choices.
 */
export function usePersistentColumnVisibility(
  storageKey: string,
  defaultColumnVisibility: VisibilityState,
): {
  columnVisibility: VisibilityState;
  setColumnVisibility: Dispatch<SetStateAction<VisibilityState>>;
  resetColumns: () => void;
} {
  const [columnVisibility, setColumnVisibility] =
    useState<VisibilityState>(defaultColumnVisibility);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          setColumnVisibility({ ...defaultColumnVisibility, ...JSON.parse(saved) });
        } catch {
          console.warn('Invalid saved column state, ignoring.');
        }
      }
    } catch {
      // localStorage may not be available in all environments
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(columnVisibility));
    } catch {
      // localStorage may not be available in all environments
    }
  }, [columnVisibility, storageKey]);

  const resetColumns = () => {
    setColumnVisibility(defaultColumnVisibility);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // localStorage may not be available in all environments
    }
  };

  return { columnVisibility, setColumnVisibility, resetColumns };
}
