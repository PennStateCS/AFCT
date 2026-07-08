import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn(), findUnique: vi.fn() },
  problem: { findFirst: vi.fn() },
  assignmentProblem: { deleteMany: vi.fn() },
  groupAssignmentProblem: { deleteMany: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('POST /api/courses/[id]/[aid]/remove-problem', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/a1/remove-problem', {
      method: 'POST',
      body: JSON.stringify({ problemId: 'p1' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 400 when missing problemId', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/courses/c1/a1/remove-problem', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 404 when assignment missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/a1/remove-problem', {
      method: 'POST',
      body: JSON.stringify({ problemId: 'p1' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 404 when problem missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1' });
    prismaMock.problem.findFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/a1/remove-problem', {
      method: 'POST',
      body: JSON.stringify({ problemId: 'p1' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

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

    const req = new Request('http://localhost/api/courses/c1/a1/remove-problem', {
      method: 'POST',
      body: JSON.stringify({ problemId: 'p1' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.problems).toHaveLength(1);
    // Ensure group mappings were removed along with the assignmentProblem link
    expect(prismaMock.groupAssignmentProblem.deleteMany).toHaveBeenCalledWith({ where: { assignmentId: 'a1', problemId: 'p1' } });
    expect(activityLogMock).toHaveBeenCalled();
  });
});
