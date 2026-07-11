import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveMock = vi.hoisted(() => vi.fn());
const canViewMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  submission: { findUnique: vi.fn() },
  assignmentProblemGrade: { findUnique: vi.fn() },
}));

vi.mock('@/lib/client-auth', () => ({ resolveClientToken: resolveMock }));
vi.mock('@/lib/permissions', () => ({ canViewStudentData: canViewMock }));
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

beforeEach(() => vi.clearAllMocks());

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
