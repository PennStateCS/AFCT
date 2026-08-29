'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { COMMON_SHARE } from '@/lib/similarity/rarity';

/**
 * Where the line between a finding and the expected answer currently sits, for everybody on
 * the page who needs to know.
 *
 * It is the reader's own setting rather than the course's, so it lives in their browser. It
 * is shared here rather than held by the Similarity tab because two parts of the assignment
 * page depend on it: the tab itself, and the count on the tab's button, which is computed by
 * the server and has to be asked the same question the page is asking. A badge saying seven
 * beside a page saying five is a badge nobody trusts.
 *
 * A tiny store rather than React state, because those two live in different components and
 * neither owns the other. Everything else about it is unchanged: the same key, the same
 * default, the same "changes what is shown, never what is recorded".
 */

/** Where the reader's own commonality setting is kept, so it survives a reload. */
export const THRESHOLD_KEY = 'afct.similarityCommonShare';

let share = COMMON_SHARE;
let hydrated = false;
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read once, after mount: the server has no localStorage and must not be told otherwise. */
function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const saved = Number(window.localStorage.getItem(THRESHOLD_KEY));
    if (Number.isFinite(saved) && saved > 0 && saved <= 1 && saved !== share) {
      share = saved;
      announce();
    }
  } catch {
    /* ignore storage the browser will not give us */
  }
}

export function setCommonShare(next: number) {
  hydrated = true;
  if (next === share) return;
  share = next;
  try {
    window.localStorage.setItem(THRESHOLD_KEY, String(next));
  } catch {
    /* ignore storage the browser will not give us */
  }
  announce();
}

/** The current threshold, and how to move it. Every caller sees the same number. */
export function useCommonShare(): [number, (next: number) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => share,
    // What the server renders with. The saved value arrives after mount, which is the only
    // moment it can: reading it during render would make the two disagree.
    () => COMMON_SHARE,
  );
  useEffect(hydrate, []);
  // Stable across renders, so a component holding it in a dependency list is not woken by it.
  const set = useCallback((next: number) => setCommonShare(next), []);
  return [value, set];
}

/** Test seam: forget the saved value so each test starts from the default. */
export function resetCommonShareForTests() {
  share = COMMON_SHARE;
  hydrated = false;
  announce();
}
