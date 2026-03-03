import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  problem: {
    findMany: vi.fn(),
  },
  assignmentProblem: {
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  assignment: {
    findUnique: vi.fn(),
  },
  group: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  groupAssignmentProblem: {
    createMany: vi.fn(),
  },

}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
  prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
  prismaMock.assignmentProblem.createMany.mockResolvedValue({ count: 0 });
  prismaMock.assignment.findUnique.mockResolvedValue({
    id: 'assignment-1',
    problems: [{ problem: { id: 'p1', title: 'P1' } }],
  });
});

describe('POST /api/courses/[id]/[aid]/add-problems', () => {
  it('returns 403 when user is not authorized', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });

    const req = new Request('http://localhost/api/courses/c1/a1/add-problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problemIds: ['p1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 400 for empty body', async () => {
    const req = new Request('http://localhost/api/courses/c1/a1/add-problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = new Request('http://localhost/api/courses/c1/a1/add-problems', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(400);
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

    const req = new Request('http://localhost/api/courses/c1/a1/add-problems', {
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
  });

  it('adds group mappings when groupId is ALL', async () => {
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p3' }]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
    prismaMock.assignmentProblem.createMany.mockResolvedValue({ count: 1 });
    prismaMock.assignment.findUnique.mockResolvedValue({ id: 'assignment-1', isGroup: true });
    prismaMock.group.findMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
    prismaMock.groupAssignmentProblem.createMany.mockResolvedValue({ count: 2 });

    const req = new Request('http://localhost/api/courses/c1/a1/add-problems', {
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
  });

  it('adds group mapping for a specified groupId', async () => {
    prismaMock.problem.findMany.mockResolvedValue([{ id: 'p4' }]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);
    prismaMock.assignmentProblem.createMany.mockResolvedValue({ count: 1 });
    prismaMock.assignment.findUnique.mockResolvedValue({ id: 'assignment-1', isGroup: true });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g-x', courseId: 'c1' });
    prismaMock.groupAssignmentProblem.createMany.mockResolvedValue({ count: 1 });

    const req = new Request('http://localhost/api/courses/c1/a1/add-problems', {
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
    prismaMock.assignmentProblem.findMany.mockResolvedValue([{ problemId: 'p5', _count: { submissions: 0 } }]);
    prismaMock.assignmentProblem.createMany.mockResolvedValue({ count: 0 });
    prismaMock.assignment.findUnique.mockResolvedValue({ id: 'assignment-1', isGroup: true });
    prismaMock.group.findUnique.mockResolvedValue({ id: 'g-y', courseId: 'c1' });
    prismaMock.groupAssignmentProblem.createMany.mockResolvedValue({ count: 1 });

    const req = new Request('http://localhost/api/courses/c1/a1/add-problems', {
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

    const req = new Request('http://localhost/api/courses/c1/a1/add-problems', {
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

    const req = new Request('http://localhost/api/courses/c1/a1/add-problems', {
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
