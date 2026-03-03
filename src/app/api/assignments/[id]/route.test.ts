import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignment: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
  roster: { findFirst: vi.fn() },
  assignmentProblem: { findFirst: vi.fn(), deleteMany: vi.fn() },
  assignmentGrade: { findFirst: vi.fn() },
  submission: { findFirst: vi.fn(), count: vi.fn() },
  user: { findUnique: vi.fn() },
  systemSettings: { findUnique: vi.fn() },
  comment: { count: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const toEndOfDayInTimezoneMock = vi.hoisted(() => vi.fn());
const toDateTimeInTimezoneMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/date-utils', () => ({
  toEndOfDayInTimezone: toEndOfDayInTimezoneMock,
  toDateTimeInTimezone: toDateTimeInTimezoneMock,
}));

import { GET, PUT, PATCH, POST, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  toEndOfDayInTimezoneMock.mockReturnValue(new Date('2025-01-01T00:00:00.000Z'));
  toDateTimeInTimezoneMock.mockReturnValue(new Date('2025-01-02T00:00:00.000Z'));
});

describe('GET /api/assignments/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 when assignment not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 404 when student cannot access unpublished assignment', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: false,
    });

    const req = new NextRequest('http://localhost/api/assignments/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 404 when student not enrolled in course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: true,
    });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('returns assignment when student is enrolled and assignment is published', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: true,
      title: 'Assignment 1',
    });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'STUDENT' });

    const req = new NextRequest('http://localhost/api/assignments/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('a1');
  });

  it('returns 404 when FACULTY/TA not in course roster', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
    });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('returns assignment when FACULTY/TA has access', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      title: 'Assignment 1',
    });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'FACULTY' });

    const req = new NextRequest('http://localhost/api/assignments/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('a1');
  });

  it('returns assignment when ADMIN', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      title: 'Assignment 1',
    });

    const req = new NextRequest('http://localhost/api/assignments/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('a1');
  });
});

describe('PUT /api/assignments/[id]', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'A' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when student attempts to update', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'A' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when unpublishing assignment with submissions', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue({ assignmentId: 'a1' });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'A', isPublished: false }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('submissions');
  });

  it('returns 403 when unpublishing assignment with grades', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(null);
    prismaMock.assignmentGrade.findFirst.mockResolvedValue({ assignmentId: 'a1' });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'A', isPublished: false }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('grades');
  });

  it('updates assignment and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(null);
    prismaMock.assignmentGrade.findFirst.mockResolvedValue(null);
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      title: 'Assignment',
      description: 'Old',
      dueDate: new Date('2025-01-01T00:00:00.000Z'),
      isPublished: false,
      allowLateSubmissions: false,
      lateCutoff: null,
    });
    prismaMock.assignment.update.mockResolvedValue({ id: 'a1', courseId: 'c1' });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'A', dueDate: '2025-01-01', isPublished: true }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.assignment.update).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('uses system timezone when user timezone not available', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(null);
    prismaMock.assignmentGrade.findFirst.mockResolvedValue(null);
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      title: 'Assignment',
      description: null,
      dueDate: new Date('2025-01-01T00:00:00.000Z'),
      isPublished: true,
      allowLateSubmissions: false,
      lateCutoff: null,
    });
    prismaMock.assignment.update.mockResolvedValue({ id: 'a1', courseId: 'c1' });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'A', dueDate: '2025-01-01' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
  });

  it('returns 400 when enabling late submissions without cutoff (PUT)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(null);
    prismaMock.assignmentGrade.findFirst.mockResolvedValue(null);
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      title: 'Assignment',
      description: null,
      dueDate: new Date('2025-01-01T00:00:00.000Z'),
      isPublished: true,
      allowLateSubmissions: false,
      lateCutoff: null,
    });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PUT',
      body: JSON.stringify({
        title: 'Assignment',
        dueDate: '2025-01-01',
        allowLateSubmissions: true,
      }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('cutoff');
  });

  it('returns 400 when late cutoff is before due date (PUT)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(null);
    prismaMock.assignmentGrade.findFirst.mockResolvedValue(null);
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      title: 'Assignment',
      description: null,
      dueDate: new Date('2025-01-01T00:00:00.000Z'),
      isPublished: true,
      allowLateSubmissions: true,
      lateCutoff: new Date('2025-01-02T00:00:00.000Z'),
    });
    toDateTimeInTimezoneMock.mockReturnValueOnce(new Date('2024-12-31T00:00:00.000Z'));

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PUT',
      body: JSON.stringify({
        title: 'Assignment',
        dueDate: '2025-01-01',
        allowLateSubmissions: true,
        lateCutoff: '2024-12-31T12:00',
      }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('after the due date');
  });
});

describe('PATCH /api/assignments/[id]', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'A' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('prevents changing group mode if submissions exist', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.submission.count.mockResolvedValue(1);

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PATCH',
      body: JSON.stringify({ isGroup: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/assignments/[id]', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'POST',
      body: JSON.stringify({ title: 'A', courseId: 'c1' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('returns 403 when student attempts to create', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'POST',
      body: JSON.stringify({ title: 'A', courseId: 'c1' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 when missing required fields (title)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'POST',
      body: JSON.stringify({ courseId: 'c1' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when missing required fields (courseId)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'POST',
      body: JSON.stringify({ title: 'Assignment 1' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('creates assignment with defaults and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });
    prismaMock.assignment.create.mockResolvedValue({
      id: 'a1',
      title: 'Assignment 1',
      courseId: 'c1',
      isPublished: false,
      allowLateSubmissions: false,
      lateCutoff: null,
    });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'POST',
      body: JSON.stringify({ title: 'Assignment 1', courseId: 'c1', allowLateSubmissions: false }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(prismaMock.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Assignment 1',
          courseId: 'c1',
          isPublished: false,
          allowLateSubmissions: false,
          lateCutoff: null,
        }),
      }),
    );
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('creates assignment with all fields provided', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.assignment.create.mockResolvedValue({
      id: 'a2',
      title: 'Homework 1',
      description: 'Complete all problems',
      courseId: 'c1',
      isPublished: true,
      allowLateSubmissions: true,
      lateCutoff: new Date('2025-02-02T00:00:00.000Z'),
    });
    toDateTimeInTimezoneMock.mockReturnValueOnce(new Date('2025-02-02T00:00:00.000Z'));

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Homework 1',
        description: 'Complete all problems',
        courseId: 'c1',
        isPublished: true,
        dueDate: '2025-02-01',
        allowLateSubmissions: true,
        lateCutoff: '2025-02-02T12:00',
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.isPublished).toBe(true);
    expect(prismaMock.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          allowLateSubmissions: true,
          lateCutoff: new Date('2025-02-02T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('returns 400 when enabling late submissions without cutoff (POST)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'POST',
      body: JSON.stringify({ title: 'Assignment 1', courseId: 'c1', allowLateSubmissions: true }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('cutoff');
  });

  it('returns 400 when late cutoff is before due date (POST)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    toEndOfDayInTimezoneMock.mockReturnValueOnce(new Date('2025-02-02T00:00:00.000Z'));
    toDateTimeInTimezoneMock.mockReturnValueOnce(new Date('2025-01-01T00:00:00.000Z'));

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Homework 1',
        courseId: 'c1',
        allowLateSubmissions: true,
        lateCutoff: '2025-01-01T00:00',
        dueDate: '2025-02-01',
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('after the due date');
  });
});

describe('DELETE /api/assignments/[id]', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when student attempts to delete', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/assignments/a1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 404 when assignment not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 400 when assignment has submissions', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ id: 'a1', courseId: 'c1' });
    prismaMock.submission.count.mockResolvedValue(5);

    const req = new NextRequest('http://localhost/api/assignments/a1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('submissions');
  });

  it('returns 400 when assignment has comments', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ id: 'a1', courseId: 'c1' });
    prismaMock.submission.count.mockResolvedValue(0);
    prismaMock.comment.count.mockResolvedValue(3);

    const req = new NextRequest('http://localhost/api/assignments/a1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('comments');
  });

  it('deletes assignment and associated problems, then logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      title: 'Assignment 1',
    });
    prismaMock.submission.count.mockResolvedValue(0);
    prismaMock.comment.count.mockResolvedValue(0);
    prismaMock.assignment.delete.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      title: 'Assignment 1',
    });

    const req = new NextRequest('http://localhost/api/assignments/a1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.assignmentProblem.deleteMany).toHaveBeenCalledWith({
      where: { assignmentId: 'a1' },
    });
    expect(prismaMock.assignment.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.any(Object),
      expect.objectContaining({
        action: 'DELETE_ASSIGNMENT',
        assignmentId: 'a1',
      }),
    );
  });

  it('handles activity log errors gracefully', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      title: 'Assignment 1',
    });
    prismaMock.submission.count.mockResolvedValue(0);
    prismaMock.comment.count.mockResolvedValue(0);
    prismaMock.assignment.delete.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      title: 'Assignment 1',
    });
    activityLogMock.mockRejectedValue(new Error('Log failed'));

    const req = new NextRequest('http://localhost/api/assignments/a1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
