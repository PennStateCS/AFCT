import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  assignment: { findMany: vi.fn(), create: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const resolveTzMock = vi.hoisted(() => vi.fn());
const toEndOfDayMock = vi.hoisted(() => vi.fn());
const toDateTimeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/user-timezone', () => ({ resolveUserTimezone: resolveTzMock }));
vi.mock('@/lib/date-utils', () => ({
  toEndOfDayInTimezone: toEndOfDayMock,
  toDateTimeInTimezone: toDateTimeMock,
}));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  resolveTzMock.mockResolvedValue('America/New_York');
  toEndOfDayMock.mockReturnValue(new Date('2026-01-10T23:59:00.000Z'));
  toDateTimeMock.mockReturnValue(new Date('2026-01-12T12:00:00.000Z'));
});

describe('GET /api/courses/[id]/assignments', () => {
  it('returns 400 when courseId missing', async () => {
    // Empty courseId can't match a roster row, so this test uses a global admin to
    // pass the auth gate and reach the 400 (missing course id) branch.
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new NextRequest('http://localhost/api/courses//assignments');
    const res = await GET(req, { params: Promise.resolve({ id: '' }) });

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/assignments');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 when course not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/assignments');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(404);
  });

  it('defaults totalGrade to 0 when a problem has no grades', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'c1' });
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'A',
        dueDate: new Date('2025-01-01T00:00:00Z'),
        description: null,
        problems: [{ maxPoints: 10, grades: [] }],
      },
    ]);

    const req = new NextRequest('http://localhost/api/courses/c1/assignments');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].totalGrade).toBe(0);
    expect(body[0].maxGrade).toBe(10);
  });

  it('returns 500 when fetching assignments throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'c1' });
    prismaMock.assignment.findMany.mockRejectedValueOnce(new Error('db down'));

    const req = new NextRequest('http://localhost/api/courses/c1/assignments');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(500);
  });

  it('returns assignments with grade totals', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'c1' });
    // include problems needed for grade math
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'A',
        dueDate: new Date('2025-01-01T00:00:00Z'),
        description: null,
        problems: [
          {
            maxPoints: 10,
            grades: [{ grade: 7 }],
          },
          {
            maxPoints: 5,
            grades: [{ grade: 3 }],
          },
        ],
      },
    ]);

    const req = new NextRequest('http://localhost/api/courses/c1/assignments', {
      headers: { authorization: 'Bearer test-token' },
    });
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: 'a1',
        title: 'A',
        dueDate: new Date('2025-01-01T00:00:00.000Z').toISOString(),
        description: null,
        totalGrade: 10,
        maxGrade: 15,
      },
    ]);
  });
});

describe('POST /api/courses/[id]/assignments', () => {
  const post = (body: unknown, id = 'c1') =>
    POST(
      new NextRequest(`http://localhost/api/courses/${id}/assignments`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await post({ title: 'New' });

    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller is not course staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });

    const res = await post({ title: 'New' });

    expect(res.status).toBe(403);
  });

  it('returns 400 when title is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await post({ description: 'no title' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when a late cutoff is given but late submissions are disabled', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await post({
      title: 'New',
      dueDate: '2026-01-10',
      allowLateSubmissions: false,
      lateCutoff: '2026-01-12',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when late submissions are enabled without a cutoff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await post({
      title: 'New',
      dueDate: '2026-01-10',
      allowLateSubmissions: true,
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when the late cutoff precedes the due date', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    toEndOfDayMock.mockReturnValue(new Date('2026-01-15T23:59:00.000Z'));
    toDateTimeMock.mockReturnValue(new Date('2026-01-12T12:00:00.000Z'));

    const res = await post({
      title: 'New',
      dueDate: '2026-01-15',
      allowLateSubmissions: true,
      lateCutoff: '2026-01-12',
    });

    expect(res.status).toBe(400);
  });

  it('creates the assignment in the path course and logs it', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.assignment.create.mockResolvedValue({
      id: 'a1',
      title: 'New',
      description: null,
      isPublished: false,
      isGroup: false,
      dueDate: new Date('2026-01-10T23:59:00.000Z'),
      allowLateSubmissions: false,
      lateCutoff: null,
      courseId: 'c1',
    });

    const res = await post({ title: 'New', dueDate: '2026-01-10' });

    expect(res.status).toBe(201);
    expect(prismaMock.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ courseId: 'c1', title: 'New' }) }),
    );
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 409 when the course is archived', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });

    const res = await post({ title: 'New', dueDate: '2026-01-10' });

    expect(res.status).toBe(409);
    expect(prismaMock.assignment.create).not.toHaveBeenCalled();
  });

  it('returns 500 and logs when creation fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.assignment.create.mockRejectedValue(new Error('db down'));

    const res = await post({ title: 'New', dueDate: '2026-01-10' });

    expect(res.status).toBe(500);
  });

  it('returns 500 when creation throws a non-Error value', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.assignment.create.mockRejectedValueOnce('boom');

    const res = await post({ title: 'New', dueDate: '2026-01-10' });

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'ASSIGNMENT_CREATE_ERROR',
        metadata: { error: 'unknown error' },
      }),
    );
  });
});
