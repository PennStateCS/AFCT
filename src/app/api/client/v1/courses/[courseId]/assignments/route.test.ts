import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveMock = vi.hoisted(() => vi.fn());
const canAccessMock = vi.hoisted(() => vi.fn());
const getAssignmentsMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({ course: { findUnique: vi.fn() } }));

vi.mock('@/lib/client-auth', () => ({ resolveClientToken: resolveMock }));
vi.mock('@/lib/permissions', () => ({ canAccessCourse: canAccessMock }));
vi.mock('@/lib/student-assignments', () => ({ getStudentCourseAssignments: getAssignmentsMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from './route';

const makeReq = (authHeader?: string) =>
  new Request('http://localhost/api/client/v1/courses/c1/assignments', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
const ctx = { params: Promise.resolve({ courseId: 'c1' }) };

const validUser = {
  tokenId: 't1',
  user: { id: 'u1', isAdmin: false, email: 'a@b.c', firstName: null, lastName: null },
};

beforeEach(() => vi.clearAllMocks());

describe('GET /api/client/v1/courses/[courseId]/assignments', () => {
  it('401 without a token', async () => {
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(401);
  });

  it('404 when the caller cannot access the course', async () => {
    resolveMock.mockResolvedValue(validUser);
    canAccessMock.mockResolvedValue(false);
    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(404);
    expect(getAssignmentsMock).not.toHaveBeenCalled();
  });

  it('returns assignments (answer-key file withheld) when accessible', async () => {
    resolveMock.mockResolvedValue(validUser);
    canAccessMock.mockResolvedValue(true);
    prismaMock.course.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    getAssignmentsMock.mockResolvedValue([
      {
        id: 'a1',
        title: 'HW1',
        description: null,
        dueDate: new Date('2026-01-01T00:00:00Z'),
        allowLateSubmissions: false,
        lateCutoff: null,
        problems: [
          {
            id: 'p1',
            title: 'P1',
            type: 'FA',
            autograderEnabled: true,
            maxPoints: 10,
            maxSubmissions: 3,
            grade: null,
            submissionCount: 0,
            status: '',
          },
        ],
      },
    ]);

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(getAssignmentsMock).toHaveBeenCalledWith('u1', 'c1');
    // QoL: course timezone (for rendering deadlines) + server clock (for countdowns).
    expect(body.timezone).toBe('America/New_York');
    expect(typeof body.serverTime).toBe('string');
    expect(body.assignments[0].id).toBe('a1');
    const problem = body.assignments[0].problems[0];
    expect(problem).toEqual({
      id: 'p1',
      title: 'P1',
      type: 'FA',
      maxPoints: 10,
      maxSubmissions: 3,
      submissionCount: 0,
      grade: null,
      status: '',
    });
    // No answer-key file leaked.
    expect(problem).not.toHaveProperty('fileName');
  });
});
