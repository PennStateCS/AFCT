/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from '@/hooks/use-mobile';

// jsdom has no matchMedia; provide a minimal implementation whose change
// listeners we can fire manually.
function mockMatchMedia() {
  const listeners = new Set<() => void>();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  return listeners;
}

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useIsMobile', () => {
  it('reports true below the 768px breakpoint', () => {
    mockMatchMedia();
    setWidth(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('reports false at or above the breakpoint', () => {
    mockMatchMedia();
    setWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('reacts to a media-query change', () => {
    const listeners = mockMatchMedia();
    setWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setWidth(400);
      listeners.forEach((cb) => cb());
    });
    expect(result.current).toBe(true);
  });
});
