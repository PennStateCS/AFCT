import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignment: {
    findUnique: vi.fn(),
  },
  roster: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  problem: {
    findFirst: vi.fn(),
  },
  studentGroup: {
    findFirst: vi.fn(),
  },
  assignmentProblem: {
    findUnique: vi.fn(),
  },
  comment: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const resolveGroupMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/assignment-groups', () => ({
  resolveStudentSubmissionGroupId: resolveGroupMock,
}));

import { POST, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the problem is linked to the assignment. Tests that need the
  // "not linked" path override this.
  prismaMock.assignmentProblem.findUnique.mockResolvedValue({ assignmentId: 'a1' });
});

describe('POST /api/comments', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hi', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates a comment and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({
      id: 'r1',
      role: 'STUDENT',
      course: { isPublished: true },
    });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });
    prismaMock.comment.create.mockResolvedValue({
      id: 'cm1',
      content: 'Hello',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      author: { id: 'u1', firstName: 'A', lastName: 'B', avatar: null },
      roster: { role: 'STUDENT' },
    });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('404-masks an unpublished assignment for a student commenter', async () => {
    // An enrolled student may comment on published assignments, but not on an
    // unpublished one: it stays invisible (404), and no comment is created.
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isPublished: false });
    prismaMock.roster.findFirst.mockResolvedValue({
      id: 'r1',
      role: 'STUDENT',
      course: { isPublished: true },
    });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('lets an admin comment without being added to the roster', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue(null); // admin not on the roster
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });
    prismaMock.comment.create.mockResolvedValue({
      id: 'cm-admin',
      content: 'Admin note',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      author: { id: 'admin-1', firstName: 'Admin', lastName: 'User', avatar: null },
      roster: null, // no course role, not rostered
    });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Admin note', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    // The admin is NOT auto-added to the roster; the comment is attributed via authorId.
    expect(prismaMock.roster.create).not.toHaveBeenCalled();
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorId: 'admin-1', rosterId: null }),
      }),
    );
  });

  it('returns 404 when assignment not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 403 when user not enrolled', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    // COMMENT_* has no domain keyword; the denial must carry an explicit ASSIGNMENT
    // category (else it mis-infers to SYSTEM) plus the assignment FK.
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'COMMENT_CREATE_DENIED',
        severity: 'SECURITY',
        category: 'ASSIGNMENT',
        assignmentId: 'a1',
      }),
    );
  });

  it('returns 404 when problem not in course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({
      id: 'r1',
      role: 'STUDENT',
      course: { isPublished: true },
    });
    prismaMock.problem.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("returns 403 when a student files a comment into another student's thread", async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({
      id: 'r1',
      role: 'STUDENT',
      course: { isPublished: true },
    });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // studentId names a DIFFERENT student's thread.
      body: JSON.stringify({
        content: 'Hello',
        assignmentId: 'a1',
        problemId: 'p1',
        studentId: 'other-student',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('returns 400 when the problem is not linked to the assignment', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({
      id: 'r1',
      role: 'STUDENT',
      course: { isPublished: true },
    });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue(null); // no link

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(prismaMock.comment.create).not.toHaveBeenCalled();
  });

  it('returns 404 when student not enrolled', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'FACULTY' });
    prismaMock.roster.findUnique.mockResolvedValue(null); // student lookup
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Note',
        assignmentId: 'a1',
        problemId: 'p1',
        studentId: 's1',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('maps null author fields to null in the response', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({
      id: 'r1',
      role: 'STUDENT',
      course: { isPublished: true },
    });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });
    prismaMock.comment.create.mockResolvedValue({
      id: 'cm1',
      content: 'Hello',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      author: { id: 'u1', firstName: null, lastName: null, avatar: null },
      roster: { role: null },
    });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.author).toEqual({
      id: 'u1',
      firstName: null,
      lastName: null,
      avatar: null,
      cropX: null,
      cropY: null,
      zoom: null,
      role: null,
    });
  });

  it('returns 400 on invalid input', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // content is required and non-empty; empty string fails the schema.
      body: JSON.stringify({ content: '', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request data');
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'COMMENT_CREATE_ERROR',
        severity: 'ERROR',
        category: 'ASSIGNMENT',
      }),
    );
  });

  it('returns 500 when comment creation throws a non-Zod error', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({
      id: 'r1',
      role: 'STUDENT',
      course: { isPublished: true },
    });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });
    prismaMock.comment.create.mockRejectedValueOnce(new Error('db down'));

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'COMMENT_CREATE_ERROR',
        severity: 'ERROR',
        category: 'ASSIGNMENT',
      }),
    );
  });

  // Group assignments: one comment addressed to the group, which every member reads,
  // instead of a copy per member that can be edited or deleted out of step.
  describe('addressing a group', () => {
    const groupReq = (body: Record<string, unknown>) =>
      new NextRequest('http://localhost/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Nice work', assignmentId: 'a1', problemId: 'p1', ...body }),
      });

    const seedStaff = () => {
      authMock.mockResolvedValue({ user: { id: 'fac1', isAdmin: true } });
      prismaMock.assignment.findUnique.mockResolvedValue({
        courseId: 'c1',
        isPublished: true,
        groupSetId: 'gs1',
      });
      prismaMock.roster.findFirst.mockResolvedValue({
        id: 'r1',
        role: 'FACULTY',
        course: { isPublished: true },
      });
      prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });
      prismaMock.studentGroup.findFirst.mockResolvedValue({ id: 'g1' });
      prismaMock.comment.create.mockResolvedValue({
        id: 'cm1',
        content: 'Nice work',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        author: { id: 'fac1', firstName: 'F', lastName: 'A', avatar: null },
        roster: { role: 'FACULTY' },
      });
    };

    it('lets staff address a group in the assignment set', async () => {
      seedStaff();

      const res = await POST(groupReq({ groupId: 'g1' }));

      expect(res.status).toBe(201);
      expect(prismaMock.comment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ aboutGroupId: 'g1', aboutStudentId: null }),
        }),
      );
    });

    it('records the audience in the audit entry', async () => {
      seedStaff();

      await POST(groupReq({ groupId: 'g1' }));

      expect(activityLogMock).toHaveBeenCalledWith(
        prismaMock,
        expect.anything(),
        expect.objectContaining({
          action: 'CREATE_COMMENT',
          metadata: expect.objectContaining({ aboutGroupId: 'g1' }),
        }),
      );
    });

    it('refuses a group that is not in this assignment set', async () => {
      seedStaff();
      prismaMock.studentGroup.findFirst.mockResolvedValue(null);

      const res = await POST(groupReq({ groupId: 'other-set-group' }));

      expect(res.status).toBe(404);
      expect(prismaMock.comment.create).not.toHaveBeenCalled();
    });

    it('refuses a group target on an individual assignment', async () => {
      seedStaff();
      prismaMock.assignment.findUnique.mockResolvedValue({
        courseId: 'c1',
        isPublished: true,
        groupSetId: null,
      });

      const res = await POST(groupReq({ groupId: 'g1' }));

      expect(res.status).toBe(400);
      expect(prismaMock.comment.create).not.toHaveBeenCalled();
    });

    // A student may write to their own group, which is the audience they can already
    // read, but not into another group's thread.
    it("refuses a student writing into another group's thread", async () => {
      seedStaff();
      authMock.mockResolvedValue({ user: { id: 'stu1', role: 'STUDENT' } });
      prismaMock.roster.findFirst.mockResolvedValue({
        id: 'r2',
        role: 'STUDENT',
        course: { isPublished: true },
      });
      resolveGroupMock.mockResolvedValue('their-own-group');

      const res = await POST(groupReq({ groupId: 'g1' }));

      expect(res.status).toBe(403);
      expect(prismaMock.comment.create).not.toHaveBeenCalled();
    });

    it('lets a student write to their own group', async () => {
      seedStaff();
      authMock.mockResolvedValue({ user: { id: 'stu1', role: 'STUDENT' } });
      prismaMock.roster.findFirst.mockResolvedValue({
        id: 'r2',
        role: 'STUDENT',
        course: { isPublished: true },
      });
      resolveGroupMock.mockResolvedValue('g1');

      const res = await POST(groupReq({ groupId: 'g1' }));

      expect(res.status).toBe(201);
    });

    it('rejects a comment addressed to both a student and a group', async () => {
      seedStaff();

      const res = await POST(groupReq({ groupId: 'g1', studentId: 's1' }));

      expect(res.status).toBe(400);
      expect(prismaMock.comment.create).not.toHaveBeenCalled();
    });
  });

  it('creates comment about specific student', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'FACULTY' });
    prismaMock.roster.findUnique.mockResolvedValue({ id: 'r-student' });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });
    prismaMock.comment.create.mockResolvedValue({
      id: 'cm1',
      content: 'Note about student',
      createdAt: new Date(),
      author: { id: 'u1', firstName: 'F', lastName: 'A', avatar: null },
      roster: { role: 'FACULTY' },
    });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Note about student',
        assignmentId: 'a1',
        problemId: 'p1',
        studentId: 's1',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aboutStudentId: 's1',
        }),
      }),
    );
  });
});

describe('DELETE /api/comments', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when commentId missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/comments', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it('deletes a comment and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 'cm1',
      assignmentId: 'a1',
      problemId: 'p1',
      aboutStudentId: null,
      roster: { user: { id: 'u1' } },
      assignment: { courseId: 'c1' },
    });

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);

    expect(res.status).toBe(200);
    expect(prismaMock.comment.delete).toHaveBeenCalledWith({ where: { id: 'cm1' } });
    expect(activityLogMock).toHaveBeenCalled();
    // action/category are first-class columns; they must not be duplicated inside
    // the metadata blob.
    const deleteLog = activityLogMock.mock.calls.find(
      (c) => c[2]?.action === 'DELETE_COMMENT',
    );
    expect(deleteLog?.[2]?.category).toBe('ASSIGNMENT');
    expect(deleteLog?.[2]?.metadata).not.toHaveProperty('action');
    expect(deleteLog?.[2]?.metadata).not.toHaveProperty('category');
  });

  it('returns 404 when comment not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.comment.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  it('denies a student deleting their own comment (comments are immutable)', async () => {
    authMock.mockResolvedValue({ user: { id: 'owner-id', role: 'STUDENT' } });
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 'cm1',
      assignmentId: 'a1',
      problemId: 'p1',
      aboutStudentId: null,
      roster: { user: { id: 'owner-id' } },
      assignment: { courseId: 'c1' },
    });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' }); // not staff

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(403);
    expect(prismaMock.comment.delete).not.toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'COMMENT_DELETE_DENIED',
        severity: 'SECURITY',
        category: 'ASSIGNMENT',
        assignmentId: 'a1',
      }),
    );
  });

  it('allows faculty to delete any comment', async () => {
    authMock.mockResolvedValue({ user: { id: 'fac-1', role: 'FACULTY' } });
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 'cm1',
      assignmentId: 'a1',
      problemId: 'p1',
      aboutStudentId: null,
      roster: { user: { id: 'other-user' } },
      assignment: { courseId: 'c1' },
    });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
  });

  it('returns 500 and logs when deletion throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 'cm1',
      assignmentId: 'a1',
      problemId: 'p1',
      aboutStudentId: null,
      roster: { user: { id: 'u1' } },
      assignment: { courseId: 'c1' },
    });
    prismaMock.comment.delete.mockRejectedValueOnce(new Error('db down'));

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'COMMENT_DELETE_ERROR',
        severity: 'ERROR',
        category: 'ASSIGNMENT',
      }),
    );
  });

  it('returns 403 when student tries to delete others comment', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 'cm1',
      assignmentId: 'a1',
      problemId: 'p1',
      aboutStudentId: null,
      roster: { user: { id: 'other-user' } },
      assignment: { courseId: 'c1' },
    });
    prismaMock.roster.findFirst.mockResolvedValue({
      role: 'STUDENT',
      course: { isPublished: true },
    });

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(403);
  });
});
