/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getCsrfTokenMock = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', () => ({ getCsrfToken: getCsrfTokenMock }));

import { safeSignOut } from './safe-signout';

const originalFetch = global.fetch;
const fetchMock = vi.fn();
let assignMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock.mockReset();
  getCsrfTokenMock.mockReset();
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
  it('redirects to the callback URL without hitting signout when there is no CSRF token', async () => {
    getCsrfTokenMock.mockResolvedValue(null);

    await safeSignOut({ callbackUrl: '/bye' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(assignMock).toHaveBeenCalledWith('/bye');
  });

  it('posts to the signout endpoint and follows the returned url', async () => {
    getCsrfTokenMock.mockResolvedValue('tok');
    fetchMock.mockResolvedValue({ json: async () => ({ url: '/after' }) } as Response);

    await safeSignOut({ callbackUrl: '/login' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/signout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    // The CSRF token and callback go in the form body.
    const body = fetchMock.mock.calls[0][1].body as string;
    expect(body).toContain('csrfToken=tok');
    expect(assignMock).toHaveBeenCalledWith('/after');
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

    expect(assignMock).toHaveBeenCalledWith('/login');
  });

  it('still redirects when signout throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getCsrfTokenMock.mockResolvedValue('tok');
    fetchMock.mockRejectedValue(new Error('network down'));

    await safeSignOut({ callbackUrl: '/login' });

    expect(assignMock).toHaveBeenCalledWith('/login');
    errSpy.mockRestore();
  });
});
