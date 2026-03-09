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
  const basePayload = {
    title: 'New',
    code: 'CS 101',
    semester: 'Fall',
    startDate: '2025-01-01T09:00',
    endDate: '2025-05-01T09:00',
    registrationOpenAt: '2024-12-01T09:00',
    registrationCloseAt: '2025-01-15T09:00',
    credits: 3,
  } as const;
  const makePayload = (overrides: Record<string, unknown> = {}) => ({
    ...basePayload,
    ...overrides,
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload()),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when forbidden', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload()),
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

  it('returns 400 for invalid credits', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload({ credits: 0 })),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Credits must be an integer between 1 and 6.',
    });
  });

  it('returns 400 for invalid course code format', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload({ code: 'C1' })),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Use a code like "CMPSC 221" or "MATH220".',
    });
  });

  it('returns 400 when start date is after end date', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(
        makePayload({
          startDate: '2025-06-01T09:00',
          endDate: '2025-05-01T09:00',
        }),
      ),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Start date/time must be on or before the end date/time.',
    });
  });

  it('returns 400 when self-registration open is after close', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(
        makePayload({
          registrationOpenAt: '2025-01-16T09:00',
          registrationCloseAt: '2025-01-15T09:00',
        }),
      ),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Self registration open must be on or before the close date.',
    });
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
      body: JSON.stringify(makePayload({ copyMode: 'assignments' })),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
    expect(tx.course.create).toHaveBeenCalled();
  });

  it('duplicates with problems only mode', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      assignment: { findMany: vi.fn().mockResolvedValue([]) },
      problem: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'p1', title: 'Problem 1', courseId: 'c1', type: 'FA' }]),
        create: vi.fn().mockResolvedValue({ id: 'new-p1' }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload({ copyMode: 'problems' })),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
    expect(tx.problem.create).toHaveBeenCalled();
  });

  it('duplicates with assignments and problems mode', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'TA' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      assignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'a1',
            title: 'Assignment 1',
            dueDate: new Date(),
            problems: [{ problemId: 'p1', problem: { id: 'p1', title: 'P1' } }],
          },
        ]),
        create: vi.fn().mockResolvedValue({ id: 'new-a1' }),
      },
      assignmentProblem: { create: vi.fn() },
      problem: {
        findMany: vi.fn().mockResolvedValue([{ id: 'p1', title: 'Problem 1' }]),
        create: vi.fn().mockResolvedValue({ id: 'new-p1' }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload({ copyMode: 'assignments_with_problems' })),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
    expect(tx.assignment.create).toHaveBeenCalled();
    expect(tx.assignmentProblem.create).toHaveBeenCalled();
  });

  it('copies faculty and TAs when requested', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { userId: 'u2', role: 'FACULTY' },
          { userId: 'u3', role: 'TA' },
          { userId: 'u4', role: 'STUDENT' },
        ]),
      },
      assignment: { findMany: vi.fn().mockResolvedValue([]) },
      problem: { findMany: vi.fn().mockResolvedValue([]) },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload({ copyFaculty: true, copyTAs: true })),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
    // Should create roster for current user + 2 copied (faculty + TA)
    expect(tx.roster.create).toHaveBeenCalledTimes(3);
  });

  it('uses fallback timezone from system settings', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: null });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'Europe/London' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      assignment: { findMany: vi.fn().mockResolvedValue([]) },
      problem: { findMany: vi.fn().mockResolvedValue([]) },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload()),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
  });

  it('uses legacy boolean flags for copy mode', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      assignment: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'a1', title: 'A1', dueDate: new Date(), problems: [] }]),
        create: vi.fn(),
      },
      problem: { findMany: vi.fn().mockResolvedValue([{ id: 'p1' }]), create: vi.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload({ copyAssignments: true, copyProblems: true })),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
  });
});
