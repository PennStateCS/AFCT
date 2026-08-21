/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChangePassword } from './use-change-password';

const updateMock = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => ({ update: updateMock }),
}));

describe('useChangePassword', () => {
  beforeEach(() => {
    updateMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the old/new password to the password API and refreshes the session on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChangePassword());
    await result.current('OldPass1!', 'NewPass1!');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/me/password');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ oldPassword: 'OldPass1!', newPassword: 'NewPass1!' });
    expect(updateMock).toHaveBeenCalledWith({ refreshCredentials: true });
  });

  it('throws the server error message and does not refresh the session on failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'Old password is incorrect' }) });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChangePassword());
    await expect(result.current('x', 'y')).rejects.toThrow('Old password is incorrect');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when the error response is not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useChangePassword());
    await expect(result.current('x', 'y')).rejects.toThrow('Failed to save your password');
    expect(updateMock).not.toHaveBeenCalled();
  });
});
