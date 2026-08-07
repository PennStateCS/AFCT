import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  course: { findUnique: vi.fn() },
  assignment: { findFirst: vi.fn() },
  submission: { findMany: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

const req = () => new NextRequest('http://localhost/api/courses/c1/assignments/a1/similarity');
const ctx = { params: Promise.resolve({ id: 'c1', aid: 'a1' }) };

const staff = () => prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1' });
  prismaMock.submission.findMany.mockResolvedValue([]);
});

describe('GET /api/courses/[id]/assignments/[aid]/similarity', () => {
  it('401s when signed out', async () => {
    authMock.mockResolvedValue(null);

    expect((await GET(req(), ctx)).status).toBe(401);
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });

  it('403s for a student in the course', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });

    expect((await GET(req(), ctx)).status).toBe(403);
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });

  it('allows a TA, who is course staff', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });

    const res = await GET(req(), ctx);

    expect(res.status).toBe(200);
    expect(prismaMock.submission.findMany).toHaveBeenCalled();
  });

  it('allows a system admin who is not on the roster', async () => {
    authMock.mockResolvedValue({ user: { id: 'a1', isAdmin: true } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(req(), ctx);

    expect(res.status).toBe(200);
    expect(prismaMock.submission.findMany).toHaveBeenCalled();
  });

  it('returns suspicious submissions in the response', async () => {
    staff();
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        submittedAt: new Date('2026-01-01T12:00:00.000Z'),
        fileName: 'answer.jff',
        originalFileName: 'homework.jff',
        isSuspicious: true,
        isSuspiciousOverride: false,
        isSuspiciousReason: 'Matched another submission',
        student: { id: 'u2', firstName: 'Jane', lastName: 'Doe', avatar: null, cropX: null, cropY: null, zoom: null },
        problem: { id: 'p1', title: 'Problem 1' },
        studentGroup: null,
      },
    ]);

    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      expect.objectContaining({ id: 'sub-1', isSuspiciousReason: 'Matched another submission' }),
    ]);
  });

  it('404s when the assignment is not found in the course', async () => {
    staff();
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    expect((await GET(req(), ctx)).status).toBe(404);
  });

  it('500s when the database query fails', async () => {
    staff();
    prismaMock.submission.findMany.mockRejectedValue(new Error('DB failure'));

    expect((await GET(req(), ctx)).status).toBe(500);
  });
});
