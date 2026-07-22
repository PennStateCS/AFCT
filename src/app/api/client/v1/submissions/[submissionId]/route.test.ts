import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveMock = vi.hoisted(() => vi.fn());
const canViewMock = vi.hoisted(() => vi.fn());
const canAccessMock = vi.hoisted(() => vi.fn());
const canManageMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  submission: { findUnique: vi.fn() },
  assignment: { findUnique: vi.fn() },
  assignmentProblemGrade: { findUnique: vi.fn() },
}));

vi.mock('@/lib/client-auth', () => ({ resolveClientToken: resolveMock }));
vi.mock('@/lib/permissions', () => ({
  canViewStudentData: canViewMock,
  canAccessCourse: canAccessMock,
  canManageCourse: canManageMock,
  isAdmin: (u: { isAdmin?: boolean } | null) => !!u?.isAdmin,
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from './route';

const makeReq = (authHeader?: string) =>
  new Request('http://localhost/api/client/v1/submissions/s1', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
const ctx = { params: Promise.resolve({ submissionId: 's1' }) };
const validUser = {
  tokenId: 't1',
  user: { id: 'u1', isAdmin: false, email: 'a@b.c', firstName: null, lastName: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Defaults: an enrolled student reading their own work in a published assignment.
  canAccessMock.mockResolvedValue(true);
  canManageMock.mockResolvedValue(false);
  prismaMock.assignment.findUnique.mockResolvedValue({ isPublished: true });
});

describe('GET /api/client/v1/submissions/[submissionId]', () => {
  it('401 without a token', async () => {
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(401);
  });

  it('404 for an unknown submission', async () => {
    resolveMock.mockResolvedValue(validUser);
    prismaMock.submission.findUnique.mockResolvedValue(null);
    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(404);
  });

  it('404 when the caller may not view the submission', async () => {
    resolveMock.mockResolvedValue(validUser);
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      studentId: 'someone-else',
      courseId: 'c1',
      assignmentId: 'a1',
      problemId: 'p1',
      groupId: null,
      status: 'COMPLETED',
      correct: true,
      feedback: 'w',
    });
    canViewMock.mockResolvedValue(false);
    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(404);
  });

  it('passes the owning studentGroupId so a member of that group can view a group submission', async () => {
    resolveMock.mockResolvedValue(validUser);
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      studentId: 'someone-else',
      studentGroupId: 'group-1',
      courseId: 'c1',
      assignmentId: 'a1',
      problemId: 'p1',
      status: 'COMPLETED',
      correct: true,
      feedback: 'w',
    });
    // canViewStudentData grants access via membership in the owning group.
    canViewMock.mockResolvedValue(true);
    prismaMock.assignmentProblemGrade.findUnique.mockResolvedValue({ grade: 5 });

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(200);
    // The exact owning group is threaded through, not a course-wide "shares any group".
    expect(canViewMock).toHaveBeenCalledWith(expect.anything(), 'c1', 'someone-else', {
      studentGroupId: 'group-1',
    });
  });

  it('passes studentGroupId: null for an individual submission', async () => {
    resolveMock.mockResolvedValue(validUser);
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      studentId: 'someone-else',
      studentGroupId: null,
      courseId: 'c1',
      assignmentId: 'a1',
      problemId: 'p1',
      status: 'COMPLETED',
      correct: true,
      feedback: 'w',
    });
    canViewMock.mockResolvedValue(false);

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(404);
    expect(canViewMock).toHaveBeenCalledWith(expect.anything(), 'c1', 'someone-else', {
      studentGroupId: null,
    });
  });

  it('returns status, correct, grade, and the feedback (witness) for the owner', async () => {
    resolveMock.mockResolvedValue(validUser);
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      studentId: 'u1',
      courseId: 'c1',
      assignmentId: 'a1',
      problemId: 'p1',
      groupId: null,
      status: 'COMPLETED',
      correct: false,
      feedback: 'accepts "01" but should reject it',
    });
    canViewMock.mockResolvedValue(true);
    prismaMock.assignmentProblemGrade.findUnique.mockResolvedValue({ grade: 6 });

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 's1',
      status: 'COMPLETED',
      correct: false,
      grade: 6,
      feedback: 'accepts "01" but should reject it',
    });
  });

  it('404 for the owner once they lose course access (mirrors the web)', async () => {
    resolveMock.mockResolvedValue(validUser);
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      studentId: 'u1',
      courseId: 'c1',
      assignmentId: 'a1',
      problemId: 'p1',
      groupId: null,
      status: 'COMPLETED',
      correct: true,
      feedback: 'w',
    });
    canViewMock.mockResolvedValue(true); // self always passes canViewStudentData
    canAccessMock.mockResolvedValue(false); // ...but they were removed from the course

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(404);
  });

  it('404 for the owner when the assignment is unpublished', async () => {
    resolveMock.mockResolvedValue(validUser);
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      studentId: 'u1',
      courseId: 'c1',
      assignmentId: 'a1',
      problemId: 'p1',
      groupId: null,
      status: 'COMPLETED',
      correct: true,
      feedback: 'w',
    });
    canViewMock.mockResolvedValue(true);
    prismaMock.assignment.findUnique.mockResolvedValue({ isPublished: false });

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(404);
  });

  it('course staff can still read a submission in an unpublished assignment', async () => {
    resolveMock.mockResolvedValue(validUser);
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      studentId: 'someone-else',
      courseId: 'c1',
      assignmentId: 'a1',
      problemId: 'p1',
      groupId: null,
      status: 'COMPLETED',
      correct: true,
      feedback: 'w',
    });
    canViewMock.mockResolvedValue(true);
    canManageMock.mockResolvedValue(true); // staff bypasses the student gate
    prismaMock.assignment.findUnique.mockResolvedValue({ isPublished: false });
    prismaMock.assignmentProblemGrade.findUnique.mockResolvedValue(null);

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(200);
  });

  it('reports a still-queued submission with null result fields', async () => {
    resolveMock.mockResolvedValue(validUser);
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      studentId: 'u1',
      courseId: 'c1',
      assignmentId: 'a1',
      problemId: 'p1',
      groupId: null,
      status: 'PENDING',
      correct: null,
      feedback: null,
    });
    canViewMock.mockResolvedValue(true);
    prismaMock.assignmentProblemGrade.findUnique.mockResolvedValue(null);

    const res = await GET(makeReq('Bearer good'), ctx);
    const body = await res.json();
    expect(body.status).toBe('PENDING');
    expect(body.correct).toBeNull();
    expect(body.grade).toBeNull();
    expect(body.feedback).toBeNull();
  });
});
