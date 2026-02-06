import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  systemSettings: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/date-utils', () => ({
  toDateTimeInTimezone: vi.fn((date: string) => new Date(date)),
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/courses/[id]/duplicate', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify({
        title: 'New',
        semester: 'Fall',
        startDate: '2025-01-01',
        endDate: '2025-05-01',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when forbidden', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify({
        title: 'New',
        semester: 'Fall',
        startDate: '2025-01-01',
        endDate: '2025-05-01',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 400 when missing required fields', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify({ title: 'New' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('duplicates a course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      assignment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
      assignmentProblem: { create: vi.fn() },
      problem: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify({
        title: 'New',
        code: 'C1',
        semester: 'Fall',
        startDate: '2025-01-01',
        endDate: '2025-05-01',
        copyMode: 'assignments',
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
    expect(tx.course.create).toHaveBeenCalled();
  });
});
