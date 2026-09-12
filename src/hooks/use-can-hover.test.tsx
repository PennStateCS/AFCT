/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCanHover } from '@/hooks/use-can-hover';

// jsdom has no matchMedia. This stands in for it, reporting whatever `matches` is set to
// and letting the test fire the change listener by hand.
function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const state = { matches, queries: [] as string[] };
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    state.queries.push(query);
    return {
      get matches() {
        return state.matches;
      },
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    };
  }) as unknown as typeof window.matchMedia;
  return { listeners, state };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCanHover', () => {
  it('reports true for a pointer that can hover', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useCanHover());
    expect(result.current).toBe(true);
  });

  it('reports false for a touch screen', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useCanHover());
    expect(result.current).toBe(false);
  });

  it('asks about hovering, not about screen size', () => {
    // The whole point of the hook: a narrow window on a laptop still has a mouse, and it is
    // the mouse that makes the select's scroll buttons behave.
    const { state } = mockMatchMedia(true);
    renderHook(() => useCanHover());
    expect(state.queries[0]).toBe('(hover: hover) and (pointer: fine)');
  });

  it('reacts to the pointer changing, for a tablet that gains a trackpad', () => {
    const { listeners, state } = mockMatchMedia(false);
    const { result } = renderHook(() => useCanHover());
    expect(result.current).toBe(false);

    act(() => {
      state.matches = true;
      listeners.forEach((cb) => cb());
    });
    expect(result.current).toBe(true);
  });

  it('stays false where matchMedia is unavailable', () => {
    // Server render and older embedded browsers. False is the safe default: it only drops
    // two mouse affordances, where true would reintroduce the touch bug.
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing it for this case
    delete window.matchMedia;
    const { result } = renderHook(() => useCanHover());
    expect(result.current).toBe(false);
    window.matchMedia = original;
  });
});
