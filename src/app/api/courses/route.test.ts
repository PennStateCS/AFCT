import { describe, it, expect, beforeEach, vi } from 'vitest';
import { testRequest } from '@/test/route';

const prismaMock = vi.hoisted(() => ({
  course: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  systemSettings: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());
const validationResponseMock = vi.hoisted(() => vi.fn(() => ({ status: 500 })));
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/zod-error', () => ({
  validationResponse: validationResponseMock,
}));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  validationResponseMock.mockReturnValue({ status: 500 });
  // GET + POST are admin-only; default to an admin session (denial tests override).
  authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
});

describe('GET /api/courses', () => {
  it('returns 401 when not signed in', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(testRequest());
    expect(res.status).toBe(401);
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    const res = await GET(testRequest());
    expect(res.status).toBe(403);
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });

  it('returns courses with enrolled roster', async () => {
    prismaMock.course.findMany.mockResolvedValue([
      {
        id: 'course-1',
        name: 'Course 1',
        roster: [
          {
            role: 'FACULTY',
            user: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
          },
        ],
        assignments: [],
      },
    ]);

    const res = await GET(testRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].enrolled).toEqual([
      { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY', courseRole: 'FACULTY' },
    ]);
  });

  it('derives maxPoints and problemCount for assignments', async () => {
    prismaMock.course.findMany.mockResolvedValue([
      {
        id: 'course-1',
        name: 'Course 1',
        roster: [],
        assignments: [
          {
            id: 'a1',
            title: 'A1',
            problems: [{ maxPoints: 60 }, { maxPoints: 40 }],
          },
        ],
      },
    ]);

    const res = await GET(testRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body[0].assignments[0]).toEqual(
      expect.objectContaining({ id: 'a1', title: 'A1', maxPoints: 100, problemCount: 2 }),
    );
    // The `problems` array must be stripped from the response assignment.
    expect(body[0].assignments[0].problems).toBeUndefined();
  });

  it('returns 500 on unexpected error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    prismaMock.course.findMany.mockRejectedValue(new Error('boom'));

    const res = await GET(testRequest());
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });
});

describe('POST /api/courses', () => {
  it('creates a course and returns enrolled roster', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.course.findFirst.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue(null);

    const txMock = {
      course: {
        create: vi.fn().mockResolvedValue({
          id: 'course-1',
          name: 'Course 1',
          code: 'CS101',
          regCode: 'ABC123',
          semester: 'Fall 2026',
          credits: 3,
          startDate: new Date('2026-08-25T13:00:00.000Z'),
          endDate: new Date('2026-12-15T22:00:00.000Z'),
          isPublished: false,
          isArchived: false,
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'course-1',
          roster: [
            {
              role: 'FACULTY',
              user: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
            },
          ],
        }),
      },
      roster: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));

    const payload = {
      name: 'Course 1',
      code: 'CS101',
      semester: 'Fall 2026',
      credits: 3,
      startDate: '2026-08-25T09:00',
      endDate: '2026-12-15T17:00',
      registrationOpenAt: '2026-08-01T09:00',
      registrationCloseAt: '2026-08-31T17:00',
      instructorIds: ['u1'],
    };

    const req = new Request('http://localhost/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.course.enrolled).toEqual([
      { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY', courseRole: 'FACULTY' },
    ]);
    expect(txMock.roster.createMany).toHaveBeenCalledTimes(1);
    expect(txMock.roster.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', courseId: 'course-1', role: 'FACULTY' }],
    });
    expect(txMock.course.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startDate: expect.any(Date),
          endDate: expect.any(Date),
          // A course is never created published.
          isPublished: false,
        }),
      }),
    );
  });

  it('returns 409 when a duplicate course exists', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.course.findFirst.mockResolvedValue({ id: 'existing' });

    const req = new Request('http://localhost/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        registrationOpenAt: '2026-08-01T09:00',
        registrationCloseAt: '2026-08-31T17:00',
        instructorIds: ['u1'],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it('falls back to system timezone when user timezone is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: null });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.course.findFirst.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue(null);

    const txMock = {
      course: {
        create: vi.fn().mockResolvedValue({
          id: 'course-1',
          name: 'Course 1',
          code: 'CS101',
          regCode: 'ABC123',
          semester: 'Fall 2026',
          credits: 3,
          startDate: new Date('2026-08-25T13:00:00.000Z'),
          endDate: new Date('2026-12-15T22:00:00.000Z'),
          isPublished: false,
          isArchived: false,
        }),
        findUnique: vi.fn().mockResolvedValue({ id: 'course-1', roster: [] }),
      },
      roster: {
        createMany: vi.fn(),
      },
    };

    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));

    const req = new Request('http://localhost/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        registrationOpenAt: '2026-08-01T09:00',
        registrationCloseAt: '2026-08-31T17:00',
        instructorIds: ['u1'],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    // No timezone supplied → the course zone falls back to the system setting (not the
    // actor's), so we read SystemSettings, not the user's timezone.
    expect(prismaMock.systemSettings.findUnique).toHaveBeenCalled();
  });

  it('returns 403 when user is not authorized', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });

    const req = new Request('http://localhost/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 401 for a disabled/deleted admin even with a stale admin token', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: true, inactive: true } });

    const req = new Request('http://localhost/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', code: 'C', semester: 'F', credits: 3 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns validation response when validation fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'ADMIN', isAdmin: true } });
    validationResponseMock.mockReturnValue({ status: 400 });
    const req = new Request('http://localhost/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects a course with no faculty (400)', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: true } });

    const req = new Request('http://localhost/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        registrationOpenAt: '2026-08-01T09:00',
        registrationCloseAt: '2026-08-31T17:00',
        instructorIds: [],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('ignores a client-supplied isPublished and creates the course unpublished', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.course.findFirst.mockResolvedValue(null);

    const txMock = {
      course: {
        create: vi.fn().mockResolvedValue({
          id: 'course-1',
          name: 'Course 1',
          code: 'CS101',
          regCode: 'ABC123',
          semester: 'Fall 2026',
          credits: 3,
          startDate: new Date('2026-08-25T13:00:00.000Z'),
          endDate: new Date('2026-12-15T22:00:00.000Z'),
          isPublished: false,
          isArchived: false,
        }),
        findUnique: vi.fn().mockResolvedValue({ id: 'course-1', roster: [] }),
      },
      roster: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));

    const req = new Request('http://localhost/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        registrationOpenAt: '2026-08-01T09:00',
        registrationCloseAt: '2026-08-31T17:00',
        instructorIds: ['i1'],
        // A client cannot create a published course; the field is dropped.
        isPublished: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(txMock.course.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isPublished: false }),
      }),
    );
  });

  it('returns 500 when course creation throws a non-validation error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.course.findFirst.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockRejectedValue(new Error('db down'));
    validationResponseMock.mockReturnValue({ status: 500 });

    const req = new Request('http://localhost/api/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        registrationOpenAt: '2026-08-01T09:00',
        registrationCloseAt: '2026-08-31T17:00',
        instructorIds: ['u1'],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });
});
