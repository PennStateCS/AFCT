import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from './route';
import { __dangerousResetRateLimiter } from '@/lib/security/rate-limiter';

beforeEach(() => {
  vi.clearAllMocks();
  // The IP rate-limiter keeps in-memory buckets; reset so tests don't accumulate.
  __dangerousResetRateLimiter();
});

describe('GET /api/auth/check-email', () => {
  it('returns 400 when email missing', async () => {
    const res = await GET(new Request('http://localhost/api/auth/check-email'));

    expect(res.status).toBe(400);
  });

  it('returns exists false when not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/auth/check-email?email=a@example.com'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ exists: false });
  });

  it('returns exists true when found', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });

    const res = await GET(new Request('http://localhost/api/auth/check-email?email=a@example.com'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ exists: true });
  });

  it('rate-limits bulk enumeration from one IP with 429', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const url = 'http://localhost/api/auth/check-email?email=a@example.com';

    // The window budget is 30/IP; keep hitting until it blocks.
    let blocked: Response | null = null;
    for (let i = 0; i < 40; i++) {
      const res = await GET(new Request(url));
      if (res.status === 429) {
        blocked = res;
        break;
      }
    }

    expect(blocked).not.toBeNull();
    expect(blocked!.headers.get('Retry-After')).toBeTruthy();
    // Never leaks account details — only the error message.
    await expect(blocked!.json()).resolves.toHaveProperty('error');
  });
});
