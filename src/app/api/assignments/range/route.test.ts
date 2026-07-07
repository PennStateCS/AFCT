import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  systemSettings: { findUnique: vi.fn() },
  roster: { findMany: vi.fn(), groupBy: vi.fn() },
  assignment: { findMany: vi.fn() },
  submission: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn(), groupBy: vi.fn() },
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
    authMock.mockResolvedValue({ user: { id: 'u1' } });

    const req = new NextRequest('http://localhost/api/assignments/range', {
      method: 'POST',
      body: JSON.stringify({ start: '2025-01-01' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns empty list when no courses', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
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

  it('returns student-enhanced assignments', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.roster.findMany.mockResolvedValue([{ courseId: 'c1', role: 'STUDENT' }]);
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        courseId: 'c1',
        dueDate: new Date('2025-01-02'),
        course: { id: 'c1', code: 'C1', name: 'Course 1' },
      },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([{ assignmentId: 'a1' }]);
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/assignments/range', {
      method: 'POST',
      body: JSON.stringify({ start: '2025-01-01', end: '2025-01-03' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].crossedOut).toBe(true);
    expect(body[0].studentHasSubmission).toBe(true);
  });

  it('returns instructor-enhanced assignments', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.roster.findMany.mockResolvedValue([{ courseId: 'c1', role: 'FACULTY' }]);
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        courseId: 'c1',
        dueDate: new Date('2020-01-02'),
        course: { id: 'c1', code: 'C1', name: 'Course 1' },
      },
    ]);
    prismaMock.roster.groupBy.mockResolvedValue([{ courseId: 'c1', _count: { _all: 2 } }]);
    prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
      { assignmentId: 'a1', _count: { _all: 2 } },
    ]);

    const req = new NextRequest('http://localhost/api/assignments/range', {
      method: 'POST',
      body: JSON.stringify({ start: '2020-01-01', end: '2020-01-03' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].allGraded).toBe(true);
    expect(body[0].crossedOut).toBe(true);
  });
});
