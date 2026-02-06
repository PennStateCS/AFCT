import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignment: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
}));

const verifyTokenMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/app/utils/jwt', () => ({ verifyToken: verifyTokenMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/assignments/[id]/problems', () => {
  it('returns 400 when assignmentId missing', async () => {
    const req = new NextRequest('http://localhost/api/assignments//problems');
    const res = await GET(req, { params: Promise.resolve({ id: '' }) });

    expect(res.status).toBe(400);
  });

  it('returns 401 when token invalid', async () => {
    verifyTokenMock.mockReturnValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1/problems', {
      headers: { authorization: 'Bearer test-token' },
    });
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 when assignment not found', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'u1' });
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1/problems', {
      headers: { authorization: 'Bearer test-token' },
    });
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 403 when not enrolled', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'u1' });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1/problems', {
      headers: { authorization: 'Bearer test-token' },
    });
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('returns problems list', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'u1' });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1' });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p1',
          title: 'P',
          description: null,
          type: 'FA',
          maxStates: null,
          isDeterministic: null,
        },
        submissions: [{ id: 's1' }],
      },
    ]);

    const req = new NextRequest('http://localhost/api/assignments/a1/problems', {
      headers: { authorization: 'Bearer test-token' },
    });
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({ id: 'p1', solved: true });
  });
});
