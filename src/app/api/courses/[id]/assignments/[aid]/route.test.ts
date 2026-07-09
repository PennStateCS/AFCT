import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  assignmentProblem: { findFirst: vi.fn(), deleteMany: vi.fn() },
  assignmentProblemGrade: { findFirst: vi.fn() },
  submission: { count: vi.fn() },
  comment: { count: vi.fn() },
  user: { findUnique: vi.fn() },
  systemSettings: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const toEndOfDayMock = vi.hoisted(() => vi.fn());
const toDateTimeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/date-utils', () => ({
  toEndOfDayInTimezone: toEndOfDayMock,
  toDateTimeInTimezone: toDateTimeMock,
}));

import { GET, PUT, PATCH, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
  toEndOfDayMock.mockReturnValue(new Date('2026-01-01T00:00:00.000Z'));
  toDateTimeMock.mockReturnValue(new Date('2026-01-02T00:00:00.000Z'));
  authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
});

describe('GET /api/courses/[id]/[aid]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/c1/assignments/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-staff user is not enrolled', async () => {
    authMock.mockResolvedValue({ user: { id: 'stranger', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/c1/assignments/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(403);
  });

  it('allows an enrolled student to view a published assignment', async () => {
    authMock.mockResolvedValue({ user: { id: 'stu-1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Assignment',
      isPublished: true,
      problems: [],
      course: { name: 'Course', code: 'C1', isArchived: false },
    });

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1?view=problems'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      },
    );

    expect(res.status).toBe(200);
  });

  it('404-masks an unpublished assignment from a non-staff student', async () => {
    authMock.mockResolvedValue({ user: { id: 'stu-1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Draft',
      isPublished: false,
      problems: [],
      course: { name: 'Course', code: 'C1', isArchived: false },
    });

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1?view=problems'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      },
    );

    expect(res.status).toBe(404);
  });

  it('lets staff view an unpublished assignment', async () => {
    // Admin (staff) is unaffected by the published masking.
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Draft',
      isPublished: false,
      problems: [],
      course: { name: 'Course', code: 'C1', isArchived: false },
    });

    const res = await GET(new Request('http://localhost/api/courses/c1/assignments/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(200);
  });

  it('returns 404 when assignment not found', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/c1/assignments/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns assignment details', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Assignment',
      problems: [
        {
          problem: {
            id: 'p1',
            title: 'P1',
            description: null,
            type: null,
            maxStates: null,
            isDeterministic: null,
            fileName: null,
            originalFileName: null,
          },
        },
      ],
      course: {
        name: 'Course',
        code: 'C1',
        isArchived: false,
        roster: [{ role: 'FACULTY', user: { id: 'u1', firstName: 'A', lastName: 'B' } }],
      },
    });

    const res = await GET(new Request('http://localhost/api/courses/c1/assignments/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.course.code).toBe('C1');
    expect(body.problems).toHaveLength(1);
  });

  it('omits roster for non-full views', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Assignment',
      problems: [],
      course: {
        name: 'Course',
        code: 'C1',
        isArchived: false,
        roster: [{ role: 'FACULTY', user: { id: 'u1', firstName: 'A', lastName: 'B' } }],
      },
    });

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1?view=problems'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1' }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.course.roster).toBeUndefined();
  });

  it('treats non-finite problem points as zero', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Assignment',
      problems: [
        {
          maxPoints: NaN,
          maxSubmissions: 1,
          autograderEnabled: false,
          problem: {
            id: 'p1',
            title: 'P1',
            description: null,
            type: null,
            maxStates: null,
            isDeterministic: null,
            fileName: null,
            originalFileName: null,
          },
        },
      ],
      course: {
        name: 'Course',
        code: 'C1',
        isArchived: false,
        roster: [],
      },
    });

    const res = await GET(new Request('http://localhost/api/courses/c1/assignments/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxPoints).toBe(0);
  });

  it('returns 500 when assignment query throws', async () => {
    prismaMock.assignment.findFirst.mockRejectedValue(new Error('db down'));

    const res = await GET(new Request('http://localhost/api/courses/c1/assignments/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(500);
  });
});

const mutationParams = { params: Promise.resolve({ id: 'c1', aid: 'a1' }) };
const putReq = (body: unknown) =>
  new Request('http://localhost/api/courses/c1/assignments/a1', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
const existingAssignment = {
  id: 'a1',
  courseId: 'c1',
  title: 'Old',
  description: null,
  isGroup: false,
  isPublished: true,
  dueDate: new Date('2026-01-01T00:00:00.000Z'),
  allowLateSubmissions: false,
  lateCutoff: null,
};

describe('PUT /api/courses/[id]/assignments/[aid]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await PUT(putReq({ title: 'X' }), mutationParams);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-staff caller', async () => {
    authMock.mockResolvedValue({ user: { id: 'stu-1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue(null);
    const res = await PUT(putReq({ title: 'X' }), mutationParams);
    expect(res.status).toBe(403);
  });

  it('404s when the assignment does not belong to the course (ownership check)', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);
    const res = await PUT(putReq({ title: 'X' }), mutationParams);
    expect(res.status).toBe(404);
    expect(prismaMock.assignment.findFirst).toHaveBeenCalledWith({
      where: { id: 'a1', courseId: 'c1' },
    });
  });

  it('updates the assignment', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ ...existingAssignment });
    prismaMock.assignment.update.mockResolvedValue({ ...existingAssignment, title: 'New' });
    const res = await PUT(
      putReq({ title: 'New', dueDate: '2026-01-01', isPublished: true }),
      mutationParams,
    );
    expect(res.status).toBe(200);
    expect(prismaMock.assignment.update).toHaveBeenCalled();
  });

  it('blocks unpublishing when submissions exist', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ ...existingAssignment });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue({ assignmentId: 'a1' });
    const res = await PUT(putReq({ isPublished: false }), mutationParams);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('submissions');
  });
});

describe('PATCH /api/courses/[id]/assignments/[aid]', () => {
  it('404s when the assignment is not in the course', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);
    const res = await PATCH(
      new Request('http://localhost/api/courses/c1/assignments/a1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'X' }),
      }),
      mutationParams,
    );
    expect(res.status).toBe(404);
  });

  it('applies only the provided fields', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ ...existingAssignment });
    prismaMock.assignment.update.mockResolvedValue({ ...existingAssignment, title: 'New' });
    const res = await PATCH(
      new Request('http://localhost/api/courses/c1/assignments/a1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'New' }),
      }),
      mutationParams,
    );
    expect(res.status).toBe(200);
    expect(prismaMock.assignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({ title: 'New' }),
      }),
    );
  });
});

describe('DELETE /api/courses/[id]/assignments/[aid]', () => {
  const delReq = () =>
    new Request('http://localhost/api/courses/c1/assignments/a1', { method: 'DELETE' });

  it('404s when the assignment is not in the course', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);
    const res = await DELETE(delReq(), mutationParams);
    expect(res.status).toBe(404);
  });

  it('400s when submissions exist', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1' });
    prismaMock.submission.count.mockResolvedValue(3);
    const res = await DELETE(delReq(), mutationParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('submissions');
  });

  it('deletes when safe', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1' });
    prismaMock.submission.count.mockResolvedValue(0);
    prismaMock.comment.count.mockResolvedValue(0);
    prismaMock.assignment.delete.mockResolvedValue({ id: 'a1', courseId: 'c1', title: 'Old' });
    const res = await DELETE(delReq(), mutationParams);
    expect(res.status).toBe(200);
    expect(prismaMock.assignmentProblem.deleteMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a1' },
    });
    expect(prismaMock.assignment.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });
});
