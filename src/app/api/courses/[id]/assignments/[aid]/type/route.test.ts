import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => {
  const mock = {
    course: { findUnique: vi.fn() },
    assignment: { findFirst: vi.fn(), update: vi.fn() },
    assignmentAssignee: { deleteMany: vi.fn() },
    assignmentOverride: { deleteMany: vi.fn() },
    groupSet: { findFirst: vi.fn() },
    roster: { findFirst: vi.fn() },
    // The type guard counts work inside the transaction, under the link rows' lock. Mocked, or
    // the guard throws and the route answers 500, which a status check could read as a refusal.
    submission: { count: vi.fn() },
    assignmentProblemGrade: { count: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  // Reset + delete + update run in one transaction; run the callback against this mock.
  mock.$transaction.mockImplementation(async (cb: (tx: typeof mock) => unknown) => cb(mock));
  return mock;
});

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { PUT } from './route';

const ctx = { params: Promise.resolve({ id: 'c1', aid: 'a1' }) };
const put = (body: unknown) =>
  PUT(
    new NextRequest('http://localhost/api/courses/c1/assignments/a1/type', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    ctx,
  );

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
  prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' }); // course-auth wrapper
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', groupSetId: null });
  prismaMock.assignment.update.mockResolvedValue({ id: 'a1', groupSetId: null });
  prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => unknown) =>
    cb(prismaMock),
  );
  prismaMock.$queryRaw.mockResolvedValue([]);
  // No student work unless a test says otherwise.
  prismaMock.submission.count.mockResolvedValue(0);
  prismaMock.assignmentProblemGrade.count.mockResolvedValue(0);
});

describe('PUT /api/courses/[id]/assignments/[aid]/type', () => {
  /**
   * Changing the type rewrites what the existing work means: individual attempts land inside an
   * assignment now read as group work, group attempts point at groups from a set the assignment
   * no longer uses, and the same call clears every date override, so an extension disappears
   * from under work handed in under it.
   */
  it.each([
    ['submissions', () => prismaMock.submission.count.mockResolvedValue(1)],
    ['grades', () => prismaMock.assignmentProblemGrade.count.mockResolvedValue(1)],
  ])('refuses the change once there are %s', async (_what, arrange) => {
    prismaMock.groupSet.findFirst.mockResolvedValue({ id: 'gs1' });
    arrange();

    const res = await put({ groupSetId: 'gs1' });

    expect(res.status).toBe(409);
    expect(prismaMock.assignment.update).not.toHaveBeenCalled();
    // And the audience survives: clearing it is half the damage.
    expect(prismaMock.assignmentOverride.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.assignmentAssignee.deleteMany).not.toHaveBeenCalled();
  });

  it('holds the problem links while it counts', async () => {
    prismaMock.groupSet.findFirst.mockResolvedValue({ id: 'gs1' });

    await put({ groupSetId: 'gs1' });

    expect(String(prismaMock.$queryRaw.mock.calls[0]?.[0])).toContain('FOR UPDATE');
  });

  it('switches individual -> group, resets audience, and clears assignees + overrides', async () => {
    prismaMock.groupSet.findFirst.mockResolvedValue({ id: 'gs1' });

    const res = await put({ groupSetId: 'gs1' });

    expect(res.status).toBe(200);
    expect(prismaMock.assignmentAssignee.deleteMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a1' },
    });
    expect(prismaMock.assignmentOverride.deleteMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a1' },
    });
    expect(prismaMock.assignment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { groupSetId: 'gs1', assignedToEveryone: true },
    });
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'CHANGE_ASSIGNMENT_TYPE' }),
    );
  });

  it('switches group -> individual (groupSetId null)', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', groupSetId: 'gs1' });

    const res = await put({ groupSetId: null });

    expect(res.status).toBe(200);
    expect(prismaMock.groupSet.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.assignment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { groupSetId: null, assignedToEveryone: true },
    });
  });

  it('rejects a group set not in this course', async () => {
    prismaMock.groupSet.findFirst.mockResolvedValue(null);

    const res = await put({ groupSetId: 'gs-other' });

    expect(res.status).toBe(400);
    expect(prismaMock.assignment.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the assignment is not in the course', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await put({ groupSetId: null });

    expect(res.status).toBe(404);
  });
});

/**
 * What a type change is allowed to reach.
 *
 * Both lookups take an id from outside the handler: the assignment from the path and the
 * group set from the request body. Each has to be confirmed against the course in the URL.
 * The prisma mock answers with its fixture either way, so without the `courseId` a faculty
 * member could turn another course's assignment into group work, or point this one at a group
 * set belonging to somebody else's course.
 */
describe('what a type change is allowed to reach', () => {
  it('resolves the assignment and the target group set inside this course only', async () => {
    prismaMock.groupSet.findFirst.mockResolvedValue({ id: 'gs1' });

    const res = await put({ groupSetId: 'gs1' });
    expect(res.status).toBe(200);

    expect(prismaMock.assignment.findFirst.mock.calls[0][0]).toMatchObject({
      where: { id: 'a1', courseId: 'c1' },
    });
    expect(prismaMock.groupSet.findFirst.mock.calls[0][0]).toMatchObject({
      where: { id: 'gs1', courseId: 'c1' },
    });
  });
});
