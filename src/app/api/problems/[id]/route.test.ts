import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  problem: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  assignmentProblem: {
    findFirst: vi.fn(),
  },
  submission: {
    deleteMany: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mkdirSync = vi.fn();
  const unlinkSync = vi.fn();
  const writeFileSync = vi.fn();
  return {
    ...actual,
    mkdirSync,
    unlinkSync,
    writeFileSync,
    default: {
      ...actual,
      mkdirSync,
      unlinkSync,
      writeFileSync,
    },
  };
});

import { PUT, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  uploadLimitMock.mockResolvedValue({ maxBytes: 5 * 1024 * 1024, maxMb: 5 });
});

describe('PUT /api/problems/[id]', () => {
  it('returns 403 when not authorized', async () => {
    authMock.mockResolvedValue(null);

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('description', 'Desc');
    formData.set('type', 'FA');
    formData.set('courseId', 'course-1');

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'PUT',
      body: formData,
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 404 when problem not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.problem.findUnique.mockResolvedValue(null);

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('description', 'Desc');
    formData.set('type', 'FA');
    formData.set('courseId', 'course-1');

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'PUT',
      body: formData,
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 400 when required fields missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.problem.findUnique.mockResolvedValue({ id: 'problem-1' });

    const formData = new FormData();
    formData.set('description', 'Desc');
    formData.set('type', 'FA');
    formData.set('courseId', 'course-1');

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'PUT',
      body: formData,
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(400);
  });

  it('updates a problem and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.problem.findUnique.mockResolvedValue({
      id: 'problem-1',
      fileName: 'file-1',
      originalFileName: 'orig.jff',
    });
    prismaMock.problem.update.mockResolvedValue({ id: 'problem-1', title: 'Problem' });

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('description', 'Desc');
    formData.set('type', 'FA');
    formData.set('courseId', 'course-1');
    formData.set('maxStates', '5');
    formData.set('isDeterministic', 'true');

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'PUT',
      body: formData,
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.problem.update).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});

describe('DELETE /api/problems/[id]', () => {
  it('returns 403 when not authorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 404 when problem not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.problem.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 400 when problem is linked to an assignment', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.problem.findUnique.mockResolvedValue({ id: 'problem-1', courseId: 'course-1' });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue({ id: 'link-1' });

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(400);
  });

  it('deletes a problem and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.problem.findUnique.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file-1',
    });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.submission.deleteMany).toHaveBeenCalledWith({
      where: { problemId: 'problem-1' },
    });
    expect(prismaMock.problem.delete).toHaveBeenCalledWith({ where: { id: 'problem-1' } });
    expect(activityLogMock).toHaveBeenCalled();
  });
});
