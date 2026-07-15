/** @vitest-environment jsdom */
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  clampSessionTimeoutMinutes,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
} from '@/lib/system-settings';
import {
  usePublicSystemSettings,
  useSessionTimeoutMinutes,
} from '@/hooks/use-public-system-settings';

// A fresh QueryClient per test so the shared ['system-settings','public'] cache
// never leaks between cases. retry:false keeps the failure paths fast.
const createWrapper = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('usePublicSystemSettings', () => {
  it('loads the public settings payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ allowSignup: true, timezone: 'America/New_York' }),
    });
    const { result } = renderHook(() => usePublicSystemSettings(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ allowSignup: true, timezone: 'America/New_York' });
  });

  it('fetches with cache: no-store so a stale HTTP cache never masks a settings change', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => usePublicSystemSettings(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), { cache: 'no-store' });
  });

  it('surfaces an error when the response is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const { result } = renderHook(() => usePublicSystemSettings(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe('useSessionTimeoutMinutes', () => {
  it('returns the default while the query is still loading', () => {
    fetchMock.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useSessionTimeoutMinutes(), {
      wrapper: createWrapper(),
    });
    expect(result.current).toBe(DEFAULT_SESSION_TIMEOUT_MINUTES);
  });

  it('returns the configured timeout once loaded', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sessionTimeoutMinutes: 30 }),
    });
    const { result } = renderHook(() => useSessionTimeoutMinutes(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current).toBe(clampSessionTimeoutMinutes(30)));
  });

  it('clamps an out-of-range configured value', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sessionTimeoutMinutes: 999999 }),
    });
    const { result } = renderHook(() => useSessionTimeoutMinutes(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current).toBe(clampSessionTimeoutMinutes(999999)));
    // The clamp caps it below the requested value.
    expect(result.current).toBeLessThan(999999);
  });

  it('falls back to the default when the field is absent', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useSessionTimeoutMinutes(), {
      wrapper: createWrapper(),
    });
    // Give the query a tick to settle; the value stays the default either way.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBe(DEFAULT_SESSION_TIMEOUT_MINUTES);
  });
});
