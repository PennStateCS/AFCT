/** @vitest-environment jsdom */
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const showToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast }));

import { useUpgrade, isUpgradeInProgress } from './useUpgrade';

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
  fetchMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('isUpgradeInProgress', () => {
  it('is true only for non-terminal phases', () => {
    expect(isUpgradeInProgress({ phase: 'pulling' })).toBe(true);
    expect(isUpgradeInProgress({ phase: 'backing_up' })).toBe(true);
    expect(isUpgradeInProgress({ phase: 'healthy' })).toBe(false);
    expect(isUpgradeInProgress({ phase: 'rolled_back' })).toBe(false);
    expect(isUpgradeInProgress({ phase: 'failed' })).toBe(false);
    expect(isUpgradeInProgress(null)).toBe(false);
    expect(isUpgradeInProgress(undefined)).toBe(false);
  });
});

describe('useUpgrade', () => {
  it('does not fetch while disabled', () => {
    renderHook(() => useUpgrade(false), { wrapper: createWrapper() });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads current version, versions, and status when enabled', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        current: 'v1.0.0',
        versions: [{ tag: 'v1.0.0' }, { tag: 'v1.1.0' }],
        status: null,
        manifestError: false,
      }),
    });
    const { result } = renderHook(() => useUpgrade(true), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.info?.current).toBe('v1.0.0'));
    expect(result.current.info?.versions).toHaveLength(2);
  });

  it('POSTs the selected tag and toasts success', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ current: 'v1.0.0', versions: [], status: null, manifestError: false }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, requestId: 'r1' }) })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ current: 'v1.0.0', versions: [], status: null, manifestError: false }),
      });

    const { result } = renderHook(() => useUpgrade(true), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.info).toBeTruthy());

    result.current.startUpgrade('v1.1.0');

    await waitFor(() => expect(showToast.success).toHaveBeenCalled());
    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(postCall).toBeTruthy();
    expect(JSON.parse(postCall![1].body as string)).toEqual({ tag: 'v1.1.0' });
  });

  it('surfaces the server error message on a failed upgrade request', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ current: 'v1.0.0', versions: [], status: null, manifestError: false }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Version v9.9.9 is not an available release' }),
      });

    const { result } = renderHook(() => useUpgrade(true), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.info).toBeTruthy());

    result.current.startUpgrade('v9.9.9');

    await waitFor(() =>
      expect(showToast.error).toHaveBeenCalledWith('Version v9.9.9 is not an available release'),
    );
  });

  it('POSTs a downgrade with the restore point and toasts success', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          current: 'v1.0.0',
          versions: [],
          status: null,
          manifestError: false,
          restorePoints: [{ version: 'v0.9.0', backup: '20260101-000000' }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, requestId: 'd1' }) })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ current: 'v1.0.0', versions: [], status: null, manifestError: false }),
      });

    const { result } = renderHook(() => useUpgrade(true), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.info).toBeTruthy());

    result.current.startDowngrade({ tag: 'v0.9.0', restorePoint: '20260101-000000' });

    await waitFor(() => expect(showToast.success).toHaveBeenCalled());
    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(postCall![1].body as string)).toEqual({
      action: 'downgrade',
      tag: 'v0.9.0',
      restorePoint: '20260101-000000',
    });
  });
});
