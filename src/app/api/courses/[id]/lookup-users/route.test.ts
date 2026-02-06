import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/courses/[id]/lookup-users', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/lookup-users', {
      method: 'POST',
      body: JSON.stringify({ emails: ['a@example.com'] }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('returns empty arrays when no emails provided', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });

    const req = new NextRequest('http://localhost/api/courses/c1/lookup-users', {
      method: 'POST',
      body: JSON.stringify({ emails: [] }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ found: [], notFound: [] });
  });

  it('returns found and notFound lists', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u2', firstName: 'A', lastName: 'B', email: 'a@example.com', role: 'STUDENT' },
    ]);

    const req = new NextRequest('http://localhost/api/courses/c1/lookup-users', {
      method: 'POST',
      body: JSON.stringify({ emails: ['a@example.com', 'b@example.com'] }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toEqual([
      { id: 'u2', firstName: 'A', lastName: 'B', email: 'a@example.com', role: 'STUDENT' },
    ]);
    expect(body.notFound).toEqual(['b@example.com']);
  });
});
