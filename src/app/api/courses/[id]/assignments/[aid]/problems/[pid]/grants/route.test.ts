import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn(), findUnique: vi.fn() },
  assignmentProblem: { findFirst: vi.fn() },
  assignmentAssignee: { findFirst: vi.fn() },
  studentGroup: { findFirst: vi.fn() },
  submissionGrant: { findMany: vi.fn(), upsert: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, POST } from './route';

const ctx = { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) };

const INDIVIDUAL_LINK = {
  maxSubmissions: 3,
  assignment: { groupSetId: null, assignedToEveryone: true },
};
const GROUP_LINK = {
  maxSubmissions: 3,
  assignment: { groupSetId: 'gs1', assignedToEveryone: true },
};

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/courses/c1/assignments/a1/problems/p1/grants', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    ctx,
  );

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
  prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false, deletedAt: null });
  prismaMock.assignmentProblem.findFirst.mockResolvedValue(INDIVIDUAL_LINK);
  prismaMock.roster.findUnique.mockResolvedValue({ role: 'STUDENT', status: 'ENROLLED' });
  prismaMock.submissionGrant.findMany.mockResolvedValue([]);
  prismaMock.submissionGrant.upsert.mockImplementation(
    async (args: { create: Record<string, unknown> }) => ({
      id: 'g1',
      ...args.create,
    }),
  );
});

describe('GET /api/courses/[id]/assignments/[aid]/problems/[pid]/grants', () => {
  it('lists the grants for the problem', async () => {
    const rows = [{ id: 'g1', targetType: 'STUDENT', userId: 'stu-1', extraSubmissions: 2 }];
    prismaMock.submissionGrant.findMany.mockResolvedValue(rows);
    const res = await GET(
      new NextRequest('http://localhost/api/courses/c1/assignments/a1/problems/p1/grants'),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it('404s when the problem is not linked in this course', async () => {
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(null);
    const res = await GET(
      new NextRequest('http://localhost/api/courses/c1/assignments/a1/problems/p1/grants'),
      ctx,
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /api/courses/[id]/assignments/[aid]/problems/[pid]/grants', () => {
  it('creates a student grant and audits it', async () => {
    const res = await post({ userId: 'stu-1', extraSubmissions: 2, reason: 'wrong file' });
    expect(res.status).toBe(201);
    expect(prismaMock.submissionGrant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          targetType: 'STUDENT',
          userId: 'stu-1',
          extraSubmissions: 2,
        }),
        update: expect.objectContaining({ extraSubmissions: { increment: 2 } }),
      }),
    );
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'GRANT_EXTRA_SUBMISSIONS', severity: 'INFO' }),
    );
  });

  it('rejects a body targeting both a student and a group', async () => {
    const res = await post({ userId: 'stu-1', groupId: 'grp-1', extraSubmissions: 1 });
    expect(res.status).toBe(400);
    expect(prismaMock.submissionGrant.upsert).not.toHaveBeenCalled();
  });

  it('rejects a non-positive amount', async () => {
    const res = await post({ userId: 'stu-1', extraSubmissions: 0 });
    expect(res.status).toBe(400);
    expect(prismaMock.submissionGrant.upsert).not.toHaveBeenCalled();
  });

  it('refuses a grant on an unlimited problem', async () => {
    prismaMock.assignmentProblem.findFirst.mockResolvedValue({
      ...INDIVIDUAL_LINK,
      maxSubmissions: -1,
    });
    const res = await post({ userId: 'stu-1', extraSubmissions: 1 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unlimited/i);
  });

  it('refuses a group target on an individual assignment', async () => {
    const res = await post({ groupId: 'grp-1', extraSubmissions: 1 });
    expect(res.status).toBe(400);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'SUBMISSION_GRANT_TARGET_INVALID', severity: 'SECURITY' }),
    );
  });

  it('refuses a target who is not an active student on the roster', async () => {
    prismaMock.roster.findUnique.mockResolvedValue({ role: 'TA', status: 'ENROLLED' });
    const res = await post({ userId: 'ta-1', extraSubmissions: 1 });
    expect(res.status).toBe(400);
    expect(prismaMock.submissionGrant.upsert).not.toHaveBeenCalled();
  });

  it('refuses a student who is not assigned when the audience is limited', async () => {
    prismaMock.assignmentProblem.findFirst.mockResolvedValue({
      ...INDIVIDUAL_LINK,
      assignment: { groupSetId: null, assignedToEveryone: false },
    });
    prismaMock.assignmentAssignee.findFirst.mockResolvedValue(null);
    const res = await post({ userId: 'stu-1', extraSubmissions: 1 });
    expect(res.status).toBe(400);
  });

  it('creates a group grant when the group is in the assignment set', async () => {
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(GROUP_LINK);
    prismaMock.studentGroup.findFirst.mockResolvedValue({ id: 'grp-1' });
    const res = await post({ groupId: 'grp-1', extraSubmissions: 1 });
    expect(res.status).toBe(201);
    expect(prismaMock.submissionGrant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ targetType: 'GROUP', groupId: 'grp-1' }),
      }),
    );
  });

  it("refuses a group outside the assignment's set", async () => {
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(GROUP_LINK);
    prismaMock.studentGroup.findFirst.mockResolvedValue(null);
    const res = await post({ groupId: 'foreign-group', extraSubmissions: 1 });
    expect(res.status).toBe(400);
  });
});
