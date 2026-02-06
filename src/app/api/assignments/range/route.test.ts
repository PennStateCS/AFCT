import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  systemSettings: { findUnique: vi.fn() },
  roster: { findMany: vi.fn(), groupBy: vi.fn() },
  assignment: { findMany: vi.fn() },
  submission: { findMany: vi.fn() },
  assignmentGrade: { findMany: vi.fn(), groupBy: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/date-utils', () => ({ toEndOfDayInTimezone: vi.fn((d: string) => new Date(d)) }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/assignments/range', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/range', {
      method: 'POST',
      body: JSON.stringify({ start: '2025-01-01', end: '2025-01-02' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('returns 400 when missing dates', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/assignments/range', {
      method: 'POST',
      body: JSON.stringify({ start: '2025-01-01' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns empty list when no courses', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/assignments/range', {
      method: 'POST',
      body: JSON.stringify({ start: '2025-01-01', end: '2025-01-02' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});
