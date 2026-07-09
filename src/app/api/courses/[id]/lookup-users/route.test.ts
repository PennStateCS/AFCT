import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
  },
  roster: {
    findFirst: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

const ctx = () => ({ params: Promise.resolve({ id: 'c1' }) }) as never;
const req = (emails: string[]) =>
  new NextRequest('http://localhost/api/courses/c1/lookup-users', {
    method: 'POST',
    body: JSON.stringify({ emails }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  // Default: caller not enrolled (denied); staff tests use an admin.
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('POST /api/courses/[id]/lookup-users', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(req(['a@example.com']), ctx())).status).toBe(401);
  });

  it('returns 403 for a signed-in non-staff user', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    expect((await POST(req(['a@example.com']), ctx())).status).toBe(403);
  });

  it('returns empty arrays when no emails provided', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });

    const res = await POST(req([]), ctx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: [], notFound: [] });
  });

  it('returns found and notFound lists for course staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u2', firstName: 'A', lastName: 'B', email: 'a@example.com', role: 'STUDENT' },
    ]);

    const res = await POST(req(['a@example.com', 'b@example.com']), ctx());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toEqual([
      { id: 'u2', firstName: 'A', lastName: 'B', email: 'a@example.com', role: 'STUDENT' },
    ]);
    expect(body.notFound).toEqual(['b@example.com']);
  });
});
