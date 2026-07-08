import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  groupRoster: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const canManageCourseMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/permissions', () => ({ canManageCourse: canManageCourseMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET } from './route';

const params = { params: Promise.resolve({ id: 'course-1' }) };

function makeReq() {
  return new NextRequest('http://localhost/api/courses/course-1/group-memberships');
}

describe('GET /api/courses/[id]/group-memberships', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
    canManageCourseMock.mockResolvedValue(true);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(makeReq(), params);

    expect(res.status).toBe(401);
  });

  it('returns 403 and audits the denial when caller cannot manage the course', async () => {
    canManageCourseMock.mockResolvedValue(false);

    const res = await GET(makeReq(), params);

    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'GROUP_MEMBERSHIPS_VIEW_DENIED' }),
    );
  });

  it('returns 200 with all group memberships for the course', async () => {
    const rows = [
      { userId: 'u1', groupId: 'g1' },
      { userId: 'u2', groupId: 'g2' },
    ];
    prismaMock.groupRoster.findMany.mockResolvedValue(rows);

    const res = await GET(makeReq(), params);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ memberships: rows });
    expect(prismaMock.groupRoster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: 'course-1' } }),
    );
  });

  it('returns 500 when the query throws', async () => {
    prismaMock.groupRoster.findMany.mockRejectedValue(new Error('db fail'));

    const res = await GET(makeReq(), params);

    expect(res.status).toBe(500);
  });
});
