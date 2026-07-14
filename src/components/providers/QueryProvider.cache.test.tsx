/** @vitest-environment jsdom */

// A live demonstration that the TanStack Query cache behaves the way the app
// relies on: a remount within staleTime is served from cache (no refetch), and an
// invalidation (what our mutations do) forces exactly one refresh.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

// A trivial component that reads a cached value. Each fetch returns an
// incrementing number so we can tell a cache hit (same number) from a refetch
// (new number).
function CachedWidget() {
  const { data } = useQuery({
    queryKey: ['demo', 'value'],
    queryFn: async () => {
      const res = await fetch('/api/demo/value');
      return (await res.json()) as { n: number };
    },
    staleTime: 30_000,
  });
  return <div data-testid="value">value:{data?.n ?? '-'}</div>;
}

describe('TanStack Query cache behavior (app defaults)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    let n = 0;
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ n: ++n }) }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves a remount from cache (no refetch) within staleTime, and refetches once on invalidation', async () => {
    // One client shared across mounts, exactly like QueryProvider, whose client
    // is created once per browser session and survives route navigation.
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: false } },
    });
    const wrap = (ui: React.ReactElement) => (
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    );

    // 1) First mount → exactly one network call, value 1.
    const first = render(wrap(<CachedWidget />));
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('value:1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 2) Navigate away (unmount) and back (remount) within the 30s staleTime →
    //    served from cache, NO new request, same value.
    first.unmount();
    render(wrap(<CachedWidget />));
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('value:1'));
    expect(fetchMock).toHaveBeenCalledTimes(1); // <- the cache working: still 1

    // 3) A mutation invalidates the key (what our create/save handlers do) → the
    //    active query refetches exactly once and the value updates to 2.
    await client.invalidateQueries({ queryKey: ['demo', 'value'] });
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('value:2'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
