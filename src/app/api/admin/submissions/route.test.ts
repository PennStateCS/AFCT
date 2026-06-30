import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  submission: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { POST } from './route';

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/submissions', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const submissionRow = {
  id: 's1',
  studentId: 'u1',
  courseId: 'c1',
  assignmentId: 'a1',
  problemId: 'p1',
  correct: true,
  feedback: 'Looks good',
  student: { email: 'stu@example.com', firstName: 'Stu', lastName: 'Dent', avatar: 'av.png' },
  course: { name: 'Course 1' },
  assignmentProblem: {
    assignment: { title: 'Assignment 1' },
    problem: { title: 'Problem 1' },
    maxPoints: 10,
  },
  submittedAt: new Date('2025-01-01T00:00:00.000Z'),
  status: 'GRADED',
  fileName: 'file.jff',
  originalFileName: 'orig.jff',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/submissions', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(makeRequest({ problemIds: ['p1'] }));

    expect(res.status).toBe(401);
  });

  it('returns 403 when the user is not admin or faculty', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await POST(makeRequest({ problemIds: ['p1'] }));

    expect(res.status).toBe(403);
  });

  it('returns 400 when problemIds are missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });

  it('returns formatted submissions with merged grades', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'FACULTY' } });
    prismaMock.submission.findMany.mockResolvedValue([submissionRow]);
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
      { studentId: 'u1', assignmentId: 'a1', problemId: 'p1', grade: 8 },
    ]);

    const res = await POST(makeRequest({ problemIds: ['p1'] }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: 's1',
      studentFirstName: 'Stu',
      studentLastName: 'Dent',
      studentEmail: 'stu@example.com',
      courseName: 'Course 1',
      assignmentTitle: 'Assignment 1',
      problemTitle: 'Problem 1',
      submittedAt: '2025-01-01T00:00:00.000Z',
      status: 'GRADED',
      grade: 8,
      maxPoints: 10,
      avatar: 'av.png',
    });
  });

  it('defaults grade to null when no grade row exists', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    prismaMock.submission.findMany.mockResolvedValue([submissionRow]);
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);

    const res = await POST(makeRequest({ problemIds: ['p1'] }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].grade).toBeNull();
  });

  it('returns 500 when the query fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    prismaMock.submission.findMany.mockRejectedValue(new Error('db down'));

    const res = await POST(makeRequest({ problemIds: ['p1'] }));

    expect(res.status).toBe(500);
  });
});
