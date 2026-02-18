import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: {
    findUnique: vi.fn(),
    update: vi.fn(),
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

import { GET, PUT } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(null);
  canArchiveMock.mockResolvedValue({ canArchive: true, reason: '' });
  canUnpublishMock.mockResolvedValue({ canUnpublish: true, reason: '' });
  toDateTimeMock.mockImplementation((val: string) => new Date(val));
});

describe('GET /api/courses/[id]', () => {
  it('returns 404 when course is not found', async () => {
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
    authMock.mockResolvedValue({ user: { id: 'viewer-1', role: 'ADMIN' } });
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
      }),
    );
    expect(body.viewerRole).toBe('FACULTY');
  });
});

describe('PUT /api/courses/[id]', () => {
  it('requires at least one faculty member', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

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
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
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
});
