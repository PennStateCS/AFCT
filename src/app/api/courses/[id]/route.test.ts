import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: {
    findUnique: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  roster: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  submission: {
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  comment: {
    count: vi.fn(),
  },
  assignmentProblem: {
    findMany: vi.fn(),
  },
  systemSettings: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const canArchiveMock = vi.hoisted(() => vi.fn());
const canUnpublishMock = vi.hoisted(() => vi.fn());
const toDateTimeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/course-status-checks', () => ({
  canArchiveCourse: canArchiveMock,
  canUnpublishCourse: canUnpublishMock,
}));
vi.mock('@/lib/date-utils', () => ({
  toDateTimeInTimezone: toDateTimeMock,
}));

import { GET, PUT, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  canArchiveMock.mockResolvedValue({ canArchive: true, reason: '' });
  canUnpublishMock.mockResolvedValue({ canUnpublish: true, reason: '' });
  toDateTimeMock.mockImplementation((val: string) => new Date(val));
});

describe('GET /api/courses/[id]', () => {
  it('returns 400 when id is missing', async () => {
    const res = await GET(new Request('http://localhost/api/courses/'), {
      params: Promise.resolve({ id: '' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await GET(new Request('http://localhost/api/courses/1'), {
      params: Promise.resolve({ id: 'course-1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-staff user is not enrolled in the course', async () => {
    authMock.mockResolvedValue({ user: { id: 'stranger', role: 'STUDENT' } });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'course-1' });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/1'), {
      params: Promise.resolve({ id: 'course-1' }),
    });

    expect(res.status).toBe(403);
  });

  it('allows an enrolled student to view the course', async () => {
    authMock.mockResolvedValue({ user: { id: 'stu-1', role: 'STUDENT' } });
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'course-1',
      name: 'C1',
      code: 'CS1',
      regCode: 'ABC123',
      semester: 'Fall 2026',
      credits: 3,
      startDate: new Date('2026-08-25T13:00:00.000Z'),
      endDate: new Date('2026-12-15T22:00:00.000Z'),
      registrationOpenAt: null,
      registrationCloseAt: null,
      isPublished: true,
      isArchived: false,
      emptyStringNotation: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });

    const res = await GET(new Request('http://localhost/api/courses/1'), {
      params: Promise.resolve({ id: 'course-1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewerRole).toBe('STUDENT');
  });

  it('returns 404 when course is not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/1'), {
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns course with enrolled roster and flags', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'course-1',
      name: 'Course 1',
      code: 'CS101',
      regCode: 'ABC123',
      semester: 'Fall 2026',
      credits: 3,
      startDate: new Date('2026-08-25T13:00:00.000Z'),
      endDate: new Date('2026-12-15T22:00:00.000Z'),
      isPublished: true,
      isArchived: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      roster: [
        {
          role: 'FACULTY',
          user: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
        },
        {
          role: 'STUDENT',
          user: { id: 'u2', firstName: 'Alan', lastName: 'Turing', role: 'STUDENT' },
        },
      ],
      problems: [{ id: 'p1', title: 'P1' }],
      assignments: [
        {
          id: 'a1',
          title: 'A1',
          description: null,
          dueDate: new Date('2026-09-01T00:00:00.000Z'),
          isPublished: true,
          allowLateSubmissions: true,
          lateCutoff: new Date('2026-09-05T00:00:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          courseId: 'course-1',
          problems: [{ maxPoints: 60 }, { maxPoints: 40 }],
          _count: { problems: 2 },
        },
      ],
    });

    prismaMock.submission.findFirst.mockResolvedValue({ id: 's1' });
    prismaMock.submission.count.mockResolvedValue(2);
    prismaMock.comment.count.mockResolvedValue(1);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([{ problemId: 'p1' }]);
    authMock.mockResolvedValue({ user: { id: 'viewer-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await GET(new Request('http://localhost/api/courses/1'), {
      params: Promise.resolve({ id: 'course-1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrolled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'u1', courseRole: 'FACULTY' }),
        expect.objectContaining({ id: 'u2', courseRole: 'STUDENT', hasSubmissions: true }),
      ]),
    );
    expect(body.assignments[0]).toEqual(
      expect.objectContaining({
        maxPoints: 100,
        submissionCount: 2,
        commentCount: 1,
        hasSubmissionsOrComments: true,
        allowLateSubmissions: true,
        lateCutoff: '2026-09-05T00:00:00.000Z',
      }),
    );
    expect(body.viewerRole).toBe('FACULTY');
  });

  it('returns 500 when get throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.course.findUnique.mockRejectedValue(new Error('db error'));

    const res = await GET(new Request('http://localhost/api/courses/1'), {
      params: Promise.resolve({ id: 'course-1' }),
    });

    expect(res.status).toBe(500);
  });
});

describe('PUT /api/courses/[id]', () => {
  it('returns 400 when id is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/courses/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: false, isPublished: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: '' }) });
    expect(res.status).toBe(400);
  });

  it('returns 403 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: false, isPublished: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 400 when isArchived is not a boolean', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: 'nope', isPublished: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 403 when archive check fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    canArchiveMock.mockResolvedValue({ canArchive: false, reason: 'archive blocked' });

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: true, isPublished: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 403 when unpublish check fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    canUnpublishMock.mockResolvedValue({ canUnpublish: false, reason: 'unpublish blocked' });

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: false, isPublished: false }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 400 when registration window is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: false, isPublished: true, registrationOpenAt: null }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });
    expect(res.status).toBe(400);
  });

  it('requires at least one faculty member', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        isPublished: true,
        isArchived: false,
        instructorIds: [],
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });
    expect(res.status).toBe(400);
  });

  it('updates course and syncs faculty roster', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'America/New_York' });

    const txMock = {
      course: {
        update: vi.fn().mockResolvedValue({ id: 'course-1' }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'course-1',
          name: 'Course 1',
          code: 'CS101',
          regCode: 'ABC123',
          semester: 'Fall 2026',
          credits: 3,
          startDate: new Date('2026-08-25T13:00:00.000Z'),
          endDate: new Date('2026-12-15T22:00:00.000Z'),
          isPublished: true,
          isArchived: false,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          problems: [],
          assignments: [
            {
              id: 'a1',
              title: 'A1',
              description: null,
              dueDate: new Date('2026-09-01T00:00:00.000Z'),
              isPublished: true,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-02T00:00:00.000Z'),
              courseId: 'course-1',
              problems: [{ maxPoints: 25 }, { maxPoints: 25 }, { maxPoints: 50 }],
              _count: { problems: 3 },
            },
          ],
          roster: [
            {
              role: 'FACULTY',
              user: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
            },
          ],
        }),
      },
      roster: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'u1', role: 'FACULTY' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.submission.count.mockResolvedValue(0);
    prismaMock.comment.count.mockResolvedValue(0);
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        registrationOpenAt: '2026-07-01T09:00',
        registrationCloseAt: '2026-09-01T09:00',
        isPublished: true,
        isArchived: false,
        instructorIds: ['u1', 'u2'],
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });
    expect(res.status).toBe(200);
    expect(txMock.roster.createMany).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('rejects an empty instructor list once the registration window is provided', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        registrationOpenAt: '2026-07-01T09:00',
        registrationCloseAt: '2026-09-01T09:00',
        isPublished: true,
        isArchived: false,
        instructorIds: [],
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('At least one faculty member is required.');
  });

  it('falls back to the system timezone and groups TA/student roster rows', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    // No personal timezone -> system settings fallback path.
    prismaMock.user.findUnique.mockResolvedValue({ timezone: null });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });

    const txMock = {
      course: {
        update: vi.fn().mockResolvedValue({ id: 'course-1' }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'course-1',
          name: 'Course 1',
          code: 'CS101',
          regCode: 'ABC123',
          semester: 'Fall 2026',
          credits: 3,
          startDate: new Date('2026-08-25T13:00:00.000Z'),
          endDate: new Date('2026-12-15T22:00:00.000Z'),
          isPublished: true,
          isArchived: false,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          problems: [],
          assignments: [],
          roster: [
            { role: 'FACULTY', user: { id: 'u1', firstName: 'Ada', lastName: 'L', role: 'FACULTY' } },
            { role: 'TA', user: { id: 'u2', firstName: 'Tim', lastName: 'A', role: 'TA' } },
            { role: 'STUDENT', user: { id: 'u3', firstName: 'Sam', lastName: 'S', role: 'STUDENT' } },
          ],
        }),
      },
      roster: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'u1', role: 'FACULTY' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        registrationOpenAt: '2026-07-01T09:00',
        registrationCloseAt: '2026-09-01T09:00',
        isPublished: true,
        isArchived: false,
        instructorIds: ['u1'],
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });
    expect(res.status).toBe(200);
    expect(prismaMock.systemSettings.findUnique).toHaveBeenCalled();
    const body = await res.json();
    expect(body.enrolled).toHaveLength(3);
  });

  it('syncs faculty remove/promote/add and includes admin in instructor lists', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'America/New_York' });

    const txMock = {
      course: {
        update: vi.fn().mockResolvedValue({ id: 'course-1' }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'course-1',
          name: 'Course 1',
          code: 'CS101',
          regCode: 'ABC123',
          semester: 'Fall 2026',
          credits: 3,
          startDate: new Date('2026-08-25T13:00:00.000Z'),
          endDate: new Date('2026-12-15T22:00:00.000Z'),
          isPublished: true,
          isArchived: false,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          problems: [],
          assignments: [],
          roster: [
            {
              role: 'ADMIN',
              user: { id: 'admin-1', firstName: 'Admin', lastName: 'User', role: 'ADMIN' },
            },
            {
              role: 'FACULTY',
              user: { id: 'u3', firstName: 'Grace', lastName: 'Hopper', role: 'FACULTY' },
            },
            {
              role: 'STUDENT',
              user: { id: 's1', firstName: 'Stu', lastName: 'Dent', role: 'STUDENT' },
            },
          ],
        }),
      },
      roster: {
        findMany: vi.fn().mockResolvedValue([
          { userId: 'u1', role: 'FACULTY' },
          { userId: 'u3', role: 'TA' },
          { userId: 'u4', role: 'FACULTY' },
        ]),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));
    prismaMock.submission.count.mockResolvedValue(0);
    prismaMock.comment.count.mockResolvedValue(0);
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'ADMIN' });

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        registrationOpenAt: '2026-07-01T09:00',
        registrationCloseAt: '2026-09-01T09:00',
        isPublished: true,
        isArchived: false,
        instructorIds: ['u3', 'u5'],
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });

    expect(res.status).toBe(200);
    expect(txMock.roster.deleteMany).toHaveBeenCalled();
    expect(txMock.roster.updateMany).toHaveBeenCalled();
    expect(txMock.roster.createMany).toHaveBeenCalled();

    const body = await res.json();
    expect(body.enrolled).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'admin-1', courseRole: 'ADMIN' })]),
    );
  });

  it('returns 500 when transaction throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.$transaction.mockRejectedValue(new Error('tx failed'));

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        registrationOpenAt: '2026-07-01T09:00',
        registrationCloseAt: '2026-09-01T09:00',
        isPublished: true,
        isArchived: false,
        instructorIds: ['u1'],
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });
    expect(res.status).toBe(500);
  });

  it('returns 500 when updated course cannot be reloaded', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });

    const txMock = {
      course: {
        update: vi.fn().mockResolvedValue({ id: 'course-1' }),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      roster: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(txMock));

    const req = new Request('http://localhost/api/courses/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Course 1',
        code: 'CS101',
        semester: 'Fall 2026',
        credits: 3,
        startDate: '2026-08-25T09:00',
        endDate: '2026-12-15T17:00',
        registrationOpenAt: '2026-07-01T09:00',
        registrationCloseAt: '2026-09-01T09:00',
        isPublished: true,
        isArchived: false,
        instructorIds: ['u1'],
      }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'course-1' }) });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/courses/[id]', () => {
  it('returns 400 when id is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/courses/', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: '' }) });

    expect(res.status).toBe(400);
  });

  it('returns 403 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/1', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'course-1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when course is not archived', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.course.findFirst.mockResolvedValue({ isArchived: false });

    const req = new Request('http://localhost/api/courses/1', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'course-1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when course does not exist', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.course.findFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/1', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'course-1' }) });

    expect(res.status).toBe(403);
  });

  it('deletes archived course and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.course.findFirst.mockResolvedValue({ isArchived: true });
    prismaMock.course.delete.mockResolvedValue({ id: 'course-1', name: 'Course 1' });

    const req = new Request('http://localhost/api/courses/1', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'course-1' }) });

    expect(res.status).toBe(200);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 500 when delete throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.course.findFirst.mockResolvedValue({ isArchived: true });
    prismaMock.course.delete.mockRejectedValue(new Error('delete failed'));

    const req = new Request('http://localhost/api/courses/1', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'course-1' }) });

    expect(res.status).toBe(500);
  });
});
