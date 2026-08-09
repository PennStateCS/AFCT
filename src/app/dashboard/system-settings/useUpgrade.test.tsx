/** @vitest-environment jsdom */
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';

const showToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast }));

import { useUpgrade, isUpgradeInProgress } from './useUpgrade';

// Mirrors the app's provider, which turns focus refetching off for every query
// (QueryProvider.tsx). The upgrade status has to opt back in, so a wrapper that left the
// library default in place would pass whether or not it did.
const createWrapper = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
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

/**
 * An upgrade runs for minutes, so the admin starts it and switches away. The interval
 * timer stops when the tab loses focus, and the app turns focus refetching off globally,
 * so the panel and its live log sat frozen until someone reloaded the page.
 */
describe('useUpgrade polling while the tab is not in front', () => {
  const infoWith = (status: unknown) => ({
    ok: true,
    json: async () => ({ current: 'v1.0.0', versions: [], status, manifestError: false }),
  });

  afterEach(() => focusManager.setFocused(undefined));

  it('refetches on return to the tab while an upgrade is running', async () => {
    fetchMock.mockResolvedValue(infoWith({ phase: 'backing_up' }));
    const { result } = renderHook(() => useUpgrade(true), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.info?.status?.phase).toBe('backing_up'));

    const before = fetchMock.mock.calls.length;
    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  // The opt-in is scoped to a running upgrade: a settled panel should not refetch every
  // time the admin tabs back to a page they left open.
  it('does not refetch on focus once the upgrade has settled', async () => {
    fetchMock.mockResolvedValue(infoWith({ phase: 'healthy' }));
    const { result } = renderHook(() => useUpgrade(true), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.info?.status?.phase).toBe('healthy'));

    const before = fetchMock.mock.calls.length;
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchMock.mock.calls.length).toBe(before);
  });

  // Necessary but not sufficient on its own: browsers throttle background timers hard,
  // which is why the focus refetch above exists as well.
  it('keeps the interval running while the tab is in the background', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    fetchMock.mockResolvedValue(infoWith({ phase: 'backing_up' }));

    renderHook(() => useUpgrade(true), { wrapper });

    const query = client.getQueryCache().find({ queryKey: ['admin', 'settings', 'upgrade'] });
    expect(query?.observers[0]?.options.refetchIntervalInBackground).toBe(true);
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

  it('flips status to in-progress right after a request, without waiting for a refetch', async () => {
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

    // The cached status becomes a non-terminal phase immediately, so the panel and
    // poll start without a manual refresh. The server still reports status: null here.
    await waitFor(() =>
      expect(isUpgradeInProgress(result.current.info?.status)).toBe(true),
    );
    expect(result.current.info?.status?.toTag).toBe('v1.1.0');
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

  const selfUpdateGet = (over: Record<string, unknown> = {}) => ({
    ok: true,
    json: async () => ({
      current: 'v1.0.0',
      updaterVersion: 'v0.9.0',
      updaterAvailable: true,
      versions: [],
      status: null,
      manifestError: false,
      restorePoints: [],
      ...over,
    }),
  });

  it('self-update resolves to done when the updater comes back on the new version', async () => {
    fetchMock
      .mockResolvedValueOnce(selfUpdateGet()) // initial: updater behind
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, requestId: 's1' }) })
      .mockResolvedValue(selfUpdateGet({ updaterVersion: 'v1.0.0' })); // caught up

    const { result } = renderHook(() => useUpgrade(true), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.info?.updaterVersion).toBe('v0.9.0'));

    result.current.startSelfUpdate('v1.0.0');
    await waitFor(() => expect(result.current.selfUpdate.phase).toBe('updating'));

    void result.current.refetch();
    await waitFor(() => expect(result.current.selfUpdate.phase).toBe('done'));

    result.current.dismissSelfUpdate();
    await waitFor(() => expect(result.current.selfUpdate.phase).toBe('idle'));
  });

  it('self-update reports failure only when the updater stays behind and reports failed', async () => {
    fetchMock
      .mockResolvedValueOnce(selfUpdateGet())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, requestId: 's2' }) })
      .mockResolvedValue(
        selfUpdateGet({
          updaterVersion: 'v0.9.0',
          status: { phase: 'failed', requestId: 's2', message: 'could not download' },
        }),
      );

    const { result } = renderHook(() => useUpgrade(true), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.info).toBeTruthy());

    result.current.startSelfUpdate('v1.0.0');
    await waitFor(() => expect(result.current.selfUpdate.phase).toBe('updating'));

    void result.current.refetch();
    await waitFor(() => expect(result.current.selfUpdate.phase).toBe('failed'));
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

  it('includes force in the downgrade body only when set', async () => {
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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, requestId: 'd2' }) })
      .mockResolvedValue({
        ok: true,
        json: async () => ({ current: 'v1.0.0', versions: [], status: null, manifestError: false }),
      });

    const { result } = renderHook(() => useUpgrade(true), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.info).toBeTruthy());

    result.current.startDowngrade({ tag: 'v0.9.0', restorePoint: '20260101-000000', force: true });

    await waitFor(() => expect(showToast.success).toHaveBeenCalled());
    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(postCall![1].body as string)).toEqual({
      action: 'downgrade',
      tag: 'v0.9.0',
      restorePoint: '20260101-000000',
      force: true,
    });
  });
});
