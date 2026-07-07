/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_MAX_UPLOAD_SIZE_MB } from '@/lib/system-settings';
import { useMaxUploadSize } from '@/hooks/useMaxUploadSize';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useMaxUploadSize', () => {
  it('loads the configured max upload size', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ maxUploadSizeMb: 100 }) });
    const { result } = renderHook(() => useMaxUploadSize());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.maxMb).toBe(100);
    expect(result.current.error).toBeNull();
  });

  it('falls back to the default when the field is missing', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useMaxUploadSize());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.maxMb).toBe(DEFAULT_MAX_UPLOAD_SIZE_MB);
  });

  it('reports an error and keeps the default when the response is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useMaxUploadSize());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Could not load upload limit');
    expect(result.current.maxMb).toBe(DEFAULT_MAX_UPLOAD_SIZE_MB);
  });

  it('reports an error when the request rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useMaxUploadSize());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Could not load upload limit');
  });
});
