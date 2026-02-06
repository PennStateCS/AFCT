import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
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
});
