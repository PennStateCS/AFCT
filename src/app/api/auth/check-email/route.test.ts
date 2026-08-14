import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: vi.fn() }));

import { GET } from './route';
import { routeCtx } from '@/test/route';
import { __dangerousResetRateLimiter } from '@/lib/security/rate-limiter';

/** Whoever is asking. Administrators may; nobody else may. */
const asAdmin = () => authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });

const check = (query = '?email=a@example.com') =>
  GET(new Request(`http://localhost/api/auth/check-email${query}`), routeCtx());

beforeEach(() => {
  vi.clearAllMocks();
  asAdmin();
  // The IP rate-limiter keeps in-memory buckets; reset so tests don't accumulate.
  __dangerousResetRateLimiter();
});

describe('GET /api/auth/check-email', () => {
  /**
   * The reason this is gated at all. `/api/auth/password-reset` answers identically for every
   * address, and now in the same time too, precisely so nobody can ask whether an account
   * exists. An unauthenticated endpoint that answers it outright undoes that.
   *
   * It was unauthenticated on the reasoning that a signup form should warn before submitting.
   * The signup form never called it; the only caller is the admin-only Change User Email dialog.
   */
  it('refuses somebody who is not signed in', async () => {
    authMock.mockResolvedValue(null);

    expect((await check()).status).toBe(401);
  });

  it('refuses a signed-in person who is not an administrator', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', isAdmin: false } });

    expect((await check()).status).toBe(403);
  });

  // Refused before the database is touched, so a refusal cannot be timed against an answer.
  it('does not look the address up when it refuses', async () => {
    authMock.mockResolvedValue({ user: { id: 'u2', isAdmin: false } });

    await check();

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns 400 when email missing', async () => {
    const res = await check('');

    expect(res.status).toBe(400);
  });

  it('returns exists false when not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await check();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ exists: false });
  });

  it('returns exists true when found', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });

    const res = await check();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ exists: true });
  });

  /**
   * Kept even though the caller must now be an administrator. An admin session is not a licence
   * to read the directory at speed, and this limit is the one an administrator sees on System
   * Status, so removing it would take away a signal as well as a control.
   */
  it('rate-limits bulk enumeration from one IP with 429', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    // The window budget is 30/IP; keep hitting until it blocks.
    let blocked: Response | null = null;
    for (let i = 0; i < 40; i++) {
      const res = await check();
      if (res.status === 429) {
        blocked = res;
        break;
      }
    }

    expect(blocked).not.toBeNull();
    expect(blocked!.headers.get('Retry-After')).toBeTruthy();
    // Never leaks account details, only the error message.
    await expect(blocked!.json()).resolves.toHaveProperty('error');
  });
});
