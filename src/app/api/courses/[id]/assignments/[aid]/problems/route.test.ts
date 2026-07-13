import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  problem: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
  assignmentProblem: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  assignment: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  group: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  groupAssignmentProblem: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  // Not on any course roster by default; individual tests grant admin/staff via auth.
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
});

describe('POST /api/courses/[id]/[aid]/problems (add problems)', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
    prismaMock.assignmentProblem.createMany.mockResolvedValue({ count: 0 });
    // withAssignmentAuth resolves the assignment (and its course membership) here.
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: true,
      isGroup: false,
    });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'assignment-1',
      problems: [{ problem: { id: 'p1', title: 'P1' } }],
    });
  });

  it('returns 403 when user is not authorized', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 409 when the course is archived', async () => {
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(409);
    expect(prismaMock.assignmentProblem.createMany).not.toHaveBeenCalled();
  });

  it('returns 400 for empty body', async () => {
    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(400);
    consoleSpy.mockRestore();
  });

  it('returns 400 for invalid problemSettings', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        problemIds: ['p1'],
        // maxSubmissions 0 violates the refine (must be -1 or >= 1)
        problemSettings: [
          { problemId: 'p1', maxPoints: 5, maxSubmissions: 0, autograderEnabled: true },
        ],
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid problemSettings in request body');
    consoleSpy.mockRestore();
  });

  it('treats a non-array problemIds as empty', async () => {
    prismaMock.problem.findMany.mockResolvedValue([]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: 'not-an-array' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);
    expect(prismaMock.problem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: [] } }) }),
    );
    expect(prismaMock.assignmentProblem.createMany).not.toHaveBeenCalled();
  });

  it('reports protected problems that already have submissions', async () => {
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p1' }]);
    // Existing link with submissions > 0 -> reported as protected, not re-added.
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      { problemId: 'p1', _count: { submissions: 3 } },
    ]);
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'assignment-1',
      problems: [{ problem: { id: 'p1', title: 'P1' } }],
    });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metadata.protectedProblems).toBe(1);
    expect(body.metadata.message).toContain('preserved');
    expect(prismaMock.assignmentProblem.createMany).not.toHaveBeenCalled();
  });

  it('skips group mapping when the assignment is not a group assignment', async () => {
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p1' }]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: true,
      isGroup: false,
    });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p1'], groupId: 'ALL' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);
    expect(prismaMock.group.findMany).not.toHaveBeenCalled();
    expect(prismaMock.groupAssignmentProblem.createMany).not.toHaveBeenCalled();
  });

  it('skips group mapping when the specified group is not in the course', async () => {
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p1' }]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: true,
      isGroup: true,
    });
    // Group belongs to a different course -> not mapped.
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g-other', courseId: 'other' });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p1'], groupId: 'g-other' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);
    expect(prismaMock.groupAssignmentProblem.createMany).not.toHaveBeenCalled();
  });

  it('skips group mapping when there are no valid problems to map', async () => {
    // No valid problems -> validIds is empty, so no mappings are created even for a real group.
    prismaMock.problem.findMany.mockResolvedValue([]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: true,
      isGroup: true,
    });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1' }]);

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p999'], groupId: 'ALL' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);
    expect(prismaMock.groupAssignmentProblem.createMany).not.toHaveBeenCalled();
  });

  it('still succeeds when activity logging fails', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p1' }]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
    activityLogMock.mockRejectedValueOnce(new Error('log down'));

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);
    consoleSpy.mockRestore();
  });

  it('returns 500 when a non-Error is thrown', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.problem.findMany.mockRejectedValueOnce('boom');

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'ASSIGNMENT_ADD_PROBLEMS_ERROR',
        metadata: { error: 'unknown error' },
      }),
    );
    consoleSpy.mockRestore();
  });

  it('adds new problems without removing existing ones', async () => {
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      { problemId: 'p1', _count: { submissions: 0 } },
    ]);
    prismaMock.assignmentProblem.createMany.mockResolvedValue({ count: 1 });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'assignment-1',
      problems: [{ problem: { id: 'p1', title: 'P1' } }, { problem: { id: 'p2', title: 'P2' } }],
    });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p1', 'p2'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(prismaMock.assignmentProblem.createMany).toHaveBeenCalledWith({
      data: [
        {
          assignmentId: 'a1',
          problemId: 'p2',
          maxPoints: 0,
          maxSubmissions: 1,
          autograderEnabled: true,
        },
      ],
    });
    expect(body.problems).toHaveLength(2);
    expect(body.metadata.newProblemsAdded).toBe(1);
    // Success log renamed to match its ADD_* error/denied siblings; no group mapping here.
    const successCall = activityLogMock.mock.calls.find(
      (c) => c[2]?.action === 'ADD_ASSIGNMENT_PROBLEMS',
    );
    expect(successCall).toBeDefined();
    expect(successCall?.[2].metadata).not.toHaveProperty('groupId');
    expect(successCall?.[2].metadata).not.toHaveProperty('mappedGroupCount');
  });

  it('adds group mappings when groupId is ALL', async () => {
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p3' }]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
    prismaMock.assignmentProblem.createMany.mockResolvedValue({ count: 1 });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: true,
      isGroup: true,
    });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
    prismaMock.groupAssignmentProblem.createMany.mockResolvedValue({ count: 2 });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p3'], groupId: 'ALL' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(200);

    expect(prismaMock.group.findMany).toHaveBeenCalledWith({ where: { courseId: 'c1' } });
    expect(prismaMock.groupAssignmentProblem.createMany).toHaveBeenCalledWith({
      data: [
        { assignmentId: 'a1', problemId: 'p3', groupId: 'g1' },
        { assignmentId: 'a1', problemId: 'p3', groupId: 'g2' },
      ],
      skipDuplicates: true,
    });
    // The group-mapping branch records groupId + the mapped count so it's auditable.
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'ADD_ASSIGNMENT_PROBLEMS',
        metadata: expect.objectContaining({ groupId: 'ALL', mappedGroupCount: 2 }),
      }),
    );
  });

  it('adds group mapping for a specified groupId', async () => {
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p4' }]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
    prismaMock.assignmentProblem.createMany.mockResolvedValue({ count: 1 });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: true,
      isGroup: true,
    });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g-x', courseId: 'c1' });
    prismaMock.groupAssignmentProblem.createMany.mockResolvedValue({ count: 1 });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p4'], groupId: 'g-x' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);

    expect(prismaMock.group.findUnique).toHaveBeenCalledWith({ where: { id: 'g-x' } });
    expect(prismaMock.groupAssignmentProblem.createMany).toHaveBeenCalledWith({
      data: [{ assignmentId: 'a1', problemId: 'p4', groupId: 'g-x' }],
      skipDuplicates: true,
    });
  });

  it('allows assigning an already-present assignment problem to a group', async () => {
    // Problem is already part of the assignment (assignmentProblem.findMany returns it)
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p5' }]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      { problemId: 'p5', _count: { submissions: 0 } },
    ]);
    prismaMock.assignmentProblem.createMany.mockResolvedValue({ count: 0 });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: true,
      isGroup: true,
    });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g-y', courseId: 'c1' });
    prismaMock.groupAssignmentProblem.createMany.mockResolvedValue({ count: 1 });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p5'], groupId: 'g-y' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);

    expect(prismaMock.group.findUnique).toHaveBeenCalledWith({ where: { id: 'g-y' } });
    expect(prismaMock.groupAssignmentProblem.createMany).toHaveBeenCalledWith({
      data: [{ assignmentId: 'a1', problemId: 'p5', groupId: 'g-y' }],
      skipDuplicates: true,
    });
  });

  it('ignores invalid problem ids not in the course', async () => {
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p1' }]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
    prismaMock.assignmentProblem.createMany.mockResolvedValue({ count: 1 });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p1', 'p999'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);
    expect(prismaMock.assignmentProblem.createMany).toHaveBeenCalledWith({
      data: [
        {
          assignmentId: 'a1',
          problemId: 'p1',
          maxPoints: 0,
          maxSubmissions: 1,
          autograderEnabled: true,
        },
      ],
    });
  });

  it('applies provided problem settings for new problems', async () => {
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p2' }]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        problemIds: ['p2'],
        problemSettings: [
          {
            problemId: 'p2',
            maxPoints: 15,
            maxSubmissions: -1,
            autograderEnabled: false,
          },
        ],
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);
    expect(prismaMock.assignmentProblem.createMany).toHaveBeenCalledWith({
      data: [
        {
          assignmentId: 'a1',
          problemId: 'p2',
          maxPoints: 15,
          maxSubmissions: -1,
          autograderEnabled: false,
        },
      ],
    });
  });
});

describe('DELETE /api/courses/[id]/[aid]/problems (remove a problem)', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemId: 'p1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 409 when the course is archived', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemId: 'p1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(409);
    expect(prismaMock.assignmentProblem.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 400 when missing problemId', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'DELETE',
      body: JSON.stringify({}),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 404 when assignment missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemId: 'p1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 404 when problem missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1' });
    prismaMock.problem.findFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemId: 'p1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('removes problem and returns updated list', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1' });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', title: 'Problem' });
    prismaMock.assignment.findUnique.mockResolvedValue({
      problems: [
        {
          problem: {
            id: 'p1',
            title: 'Problem',
            description: null,
            type: null,
            maxStates: null,
            isDeterministic: null,
          },
        },
      ],
    });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemId: 'p1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.problems).toHaveLength(1);
    // Ensure group mappings were removed along with the assignmentProblem link
    expect(prismaMock.groupAssignmentProblem.deleteMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a1', problemId: 'p1' },
    });
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns an empty problem list when the reload comes back null', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1' });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', title: 'Problem' });
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemId: 'p1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.problems).toEqual([]);
  });

  it('returns 500 and logs when removal throws a non-Error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1' });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', title: 'Problem' });
    prismaMock.assignmentProblem.deleteMany.mockRejectedValueOnce('boom');

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems', {
      method: 'DELETE',
      body: JSON.stringify({ problemId: 'p1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'ASSIGNMENT_REMOVE_PROBLEM_ERROR',
        metadata: { error: 'unknown error' },
      }),
    );
    consoleSpy.mockRestore();
  });
});
