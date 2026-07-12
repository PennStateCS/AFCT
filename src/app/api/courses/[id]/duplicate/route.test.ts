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
    // The copy must end up with at least one faculty member (no actor auto-add).
    instructorIds: ['fac-1'],
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
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify({ title: 'New' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid credits', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

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
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

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
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

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
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

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
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
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
    // The explicit faculty list seeds the roster; the actor is NOT auto-added.
    expect(tx.roster.createMany).toHaveBeenCalledWith({
      data: [{ courseId: 'new-course', userId: 'fac-1', role: 'FACULTY' }],
    });
    expect(tx.roster.create).not.toHaveBeenCalled();
  });

  it('returns 400 when neither copyFaculty nor instructorIds provides faculty', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload({ instructorIds: [] })),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'Copy the faculty roster or pick at least one faculty member.',
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('duplicates with problems only mode', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
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
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
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
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: {
        create: vi.fn(),
        createMany: vi.fn(),
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
      body: JSON.stringify(
        makePayload({ copyFaculty: true, copyTAs: true, instructorIds: [] }),
      ),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
    // Copied faculty (u2) and TA (u3); the student (u4) and the actor are not added.
    expect(tx.roster.createMany).toHaveBeenCalledWith({
      data: [{ courseId: 'new-course', userId: 'u2', role: 'FACULTY' }],
    });
    expect(tx.roster.createMany).toHaveBeenCalledWith({
      data: [{ courseId: 'new-course', userId: 'u3', role: 'TA' }],
    });
    expect(tx.roster.create).not.toHaveBeenCalled();
  });

  it('uses fallback timezone from system settings', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: null });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'Europe/London' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
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
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
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

  it('returns 400 for missing required fields even with valid credits and code', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    // Valid credits + code pass their guards, but `title` (and others) are missing,
    // so the required-fields check at the next branch returns 400.
    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify({ credits: 3, code: 'CS 101' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Missing required fields' });
  });

  it('returns 400 for an invalid date/time value', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload({ startDate: 'not-a-date' })),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid date/time value.' });
  });

  it('uses legacy copyAssignments-only flag (assignments mode)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      assignment: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'a1', title: 'A1', dueDate: new Date(), problems: [] }]),
        create: vi.fn().mockResolvedValue({ id: 'new-a1' }),
      },
      assignmentProblem: { create: vi.fn() },
      problem: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload({ copyAssignments: true })),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
    // assignments mode: assignment copied, no problem copies, no link rows.
    expect(tx.assignment.create).toHaveBeenCalled();
    expect(tx.problem.create).not.toHaveBeenCalled();
    expect(tx.assignmentProblem.create).not.toHaveBeenCalled();
  });

  it('uses legacy copyProblems-only flag (problems mode)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      assignment: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
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
      body: JSON.stringify(makePayload({ copyProblems: true })),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
    expect(tx.problem.create).toHaveBeenCalled();
    expect(tx.assignment.create).not.toHaveBeenCalled();
  });

  it('dedups explicit faculty against the copied roster and skips unmapped problem links', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const tx = {
      course: { create: vi.fn().mockResolvedValue({ id: 'new-course' }) },
      roster: {
        create: vi.fn(),
        createMany: vi.fn(),
        // u2 is both copied (FACULTY on the source) and explicitly selected —
        // they must get exactly one roster row.
        findMany: vi.fn().mockResolvedValue([{ userId: 'u2', role: 'FACULTY' }]),
      },
      assignment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'a1',
            title: 'A1',
            dueDate: new Date(),
            // p-missing was never copied (not in problemIdMap) -> link is skipped.
            problems: [{ problemId: 'p-missing' }],
          },
        ]),
        create: vi.fn().mockResolvedValue({ id: 'new-a1' }),
      },
      assignmentProblem: { create: vi.fn() },
      problem: {
        // No problems attached to needed set are found, so problemIdMap stays empty.
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(
        makePayload({
          copyMode: 'assignments_with_problems',
          copyFaculty: true,
          instructorIds: ['u2', 'u9'],
        }),
      ),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
    // One faculty createMany with the deduped pair (u2 once, plus u9).
    expect(tx.roster.createMany).toHaveBeenCalledTimes(1);
    const created = tx.roster.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(2);
    expect(created.map((r: { userId: string }) => r.userId).sort()).toEqual(['u2', 'u9']);
    // The unmapped problem link must be skipped.
    expect(tx.assignmentProblem.create).not.toHaveBeenCalled();
  });

  it('returns 500 when the transaction throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.course.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockRejectedValue(new Error('tx failed'));

    const req = new NextRequest('http://localhost/api/courses/c1/duplicate', {
      method: 'POST',
      body: JSON.stringify(makePayload()),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: 'Internal server error' });
    consoleSpy.mockRestore();
  });
});
