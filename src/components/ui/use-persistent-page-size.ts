import { useEffect, useState } from 'react';

/**
 * Rows-per-page persisted to localStorage, keyed off the table's `storageKey` (the
 * same key that carries column visibility, suffixed) so each table remembers its own
 * preference. Without this, someone who works at 50 rows re-picks it on every visit.
 *
 * Starts at `defaultPageSize` and only adopts a saved value after mount: reading
 * localStorage during render would diverge between the server and client HTML.
 */
export function usePersistentPageSize(
  storageKey: string,
  defaultPageSize: number,
): [number, (size: number) => void] {
  const key = `${storageKey}-page-size`;
  const [pageSize, setPageSize] = useState(defaultPageSize);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved === null) return;
      const parsed = Number(saved);
      // Ignore anything that isn't a sane positive row count (hand-edited storage,
      // or a value left over from an older set of page-size options).
      if (Number.isInteger(parsed) && parsed > 0) setPageSize(parsed);
    } catch {
      // localStorage may not be available in all environments
    }
  }, [key]);

  const update = (size: number) => {
    setPageSize(size);
    try {
      localStorage.setItem(key, String(size));
    } catch {
      // localStorage may not be available in all environments
    }
  };

  return [pageSize, update];
}
