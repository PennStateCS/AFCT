/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getCsrfTokenMock = vi.hoisted(() => vi.fn());
const signOutMock = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({ getCsrfToken: getCsrfTokenMock, signOut: signOutMock }));

import { safeSignOut } from './safe-signout';

const originalFetch = global.fetch;
const fetchMock = vi.fn();
let assignMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock.mockReset();
  getCsrfTokenMock.mockReset();
  signOutMock.mockReset();
  signOutMock.mockResolvedValue(undefined);
  global.fetch = fetchMock as unknown as typeof fetch;
  assignMock = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { assign: assignMock },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('safeSignOut', () => {
  it('falls back to next-auth signOut (which ends the session) when there is no CSRF token', async () => {
    getCsrfTokenMock.mockResolvedValue(null);

    await safeSignOut({ callbackUrl: '/bye' });

    expect(fetchMock).not.toHaveBeenCalled();
    // Doesn't just redirect (that would leave the session intact) — actually signs out.
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/bye' });
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('posts to the signout endpoint and follows the returned url', async () => {
    getCsrfTokenMock.mockResolvedValue('tok');
    fetchMock.mockResolvedValue({ json: async () => ({ url: '/after' }) } as Response);

    await safeSignOut({ callbackUrl: '/login' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/signout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).toContain('csrfToken=tok');
    expect(assignMock).toHaveBeenCalledWith('/after');
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('falls back to the callback url when the response carries no url', async () => {
    getCsrfTokenMock.mockResolvedValue('tok');
    fetchMock.mockResolvedValue({ json: async () => ({}) } as Response);

    await safeSignOut({ callbackUrl: '/login' });

    expect(assignMock).toHaveBeenCalledWith('/login');
  });

  it('defaults the callback url to /login', async () => {
    getCsrfTokenMock.mockResolvedValue(null);

    await safeSignOut();

    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });

  it('signs out via next-auth when the manual request throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getCsrfTokenMock.mockResolvedValue('tok');
    fetchMock.mockRejectedValue(new Error('network down'));

    await safeSignOut({ callbackUrl: '/login' });

    // The manual POST failed, but the session is still ended via signOut.
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login' });
    expect(assignMock).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('redirects as a last resort only when signOut also fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getCsrfTokenMock.mockResolvedValue(null);
    signOutMock.mockRejectedValue(new Error('server unreachable'));

    await safeSignOut({ callbackUrl: '/login' });

    expect(signOutMock).toHaveBeenCalled();
    expect(assignMock).toHaveBeenCalledWith('/login');
    errSpy.mockRestore();
  });

  it('sanitizes an off-site callbackUrl to /login', async () => {
    getCsrfTokenMock.mockResolvedValue(null);

    await safeSignOut({ callbackUrl: 'https://evil.example.com' });

    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });
});
