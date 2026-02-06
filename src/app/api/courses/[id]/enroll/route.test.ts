import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  roster: { upsert: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/courses/[id]/enroll', () => {
  it('returns 400 when userId missing', async () => {
    const req = new Request('http://localhost/api/courses/c1/enroll', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 404 when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/enroll', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 401 when user inactive', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', role: 'STUDENT', inactive: true });

    const req = new Request('http://localhost/api/courses/c1/enroll', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('enrolls user and logs activity', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', role: 'STUDENT', inactive: false });
    authMock.mockResolvedValue({ user: { id: 'admin' } });

    const req = new Request('http://localhost/api/courses/c1/enroll', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.roster.upsert).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});
