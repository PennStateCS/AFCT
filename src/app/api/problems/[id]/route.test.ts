import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  problem: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  roster: {
    findFirst: vi.fn(),
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
const fsMock = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
vi.mock('@/app/utils/xmlStructureValidate', () => ({
  validateStructureXML: vi.fn().mockReturnValue({ isValid: true }),
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: fsMock.mkdirSync,
    unlinkSync: fsMock.unlinkSync,
    writeFileSync: fsMock.writeFileSync,
    default: {
      ...actual,
      mkdirSync: fsMock.mkdirSync,
      unlinkSync: fsMock.unlinkSync,
      writeFileSync: fsMock.writeFileSync,
    },
  };
});

import { PUT, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
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
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.problem.findUnique.mockResolvedValue({ id: 'problem-1', courseId: 'course-1' });

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
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.problem.findUnique.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file-1',
      originalFileName: 'orig.jff',
    });
    prismaMock.problem.update.mockResolvedValue({ id: 'problem-1', title: 'Problem' });

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('description', 'Desc');
    formData.set('type', 'FA');
    formData.set('courseId', 'course-1');
    formData.set('maxSubmissions', '10');
    formData.set('maxPoints', '50');
    formData.set('maxStates', '5');
    formData.set('isDeterministic', 'true');
    formData.set('autograderEnabled', 'true');

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'PUT',
      body: formData,
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.problem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'problem-1' },
        data: expect.objectContaining({
          maxSubmissions: 10,
          maxPoints: 50,
          autograderEnabled: true,
        }),
      }),
    );
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 413 when uploaded file exceeds configured limit', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.problem.findUnique.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'file-1',
      originalFileName: 'orig.jff',
    });
    uploadLimitMock.mockResolvedValue({ maxBytes: 2, maxMb: 0.000002 });

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('description', 'Desc');
    formData.set('type', 'FA');
    formData.set('courseId', 'course-1');
    formData.set('file', new File(['12345'], 'oversized.jff'));

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'PUT',
      body: formData,
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(413);
    expect(prismaMock.problem.update).not.toHaveBeenCalled();
  });

  it('updates file and continues when old file deletion fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.problem.findUnique.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'old-file.jff',
      originalFileName: 'old-file.jff',
    });
    prismaMock.problem.update.mockResolvedValue({ id: 'problem-1', title: 'PDA Problem' });
    fsMock.unlinkSync.mockImplementation(() => {
      throw new Error('cannot delete old file');
    });

    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const formData = new FormData();
    formData.set('title', 'PDA Problem');
    formData.set('description', 'Desc');
    formData.set('type', 'PDA');
    formData.set('courseId', 'course-1');
    formData.set('autograderEnabled', 'false');
    formData.set('maxPoints', '');
    formData.set('maxSubmissions', '');
    formData.set('file', new File(['content'], 'new-file.jff'));

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'PUT',
      body: formData,
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(200);
    expect(fsMock.mkdirSync).toHaveBeenCalled();
    expect(fsMock.unlinkSync).toHaveBeenCalled();
    expect(fsMock.writeFileSync).toHaveBeenCalled();
    expect(prismaMock.problem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileName: '1700000000000-new-file.jff',
          originalFileName: 'new-file.jff',
          maxSubmissions: null,
          maxPoints: undefined,
          maxStates: null,
          isDeterministic: null,
          autograderEnabled: false,
        }),
      }),
    );

    dateNowSpy.mockRestore();
  });

  it('returns 500 when problem update throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.problem.findUnique.mockResolvedValue({ id: 'problem-1', courseId: 'course-1', fileName: null });
    prismaMock.problem.update.mockRejectedValue(new Error('db failed'));

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

    expect(res.status).toBe(500);
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
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
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
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
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

  it('continues deleting when problem file unlink fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.problem.findUnique.mockResolvedValue({
      id: 'problem-1',
      courseId: 'course-1',
      fileName: 'missing-file.jff',
    });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(null);
    fsMock.unlinkSync.mockImplementation(() => {
      throw new Error('missing file');
    });

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.problem.delete).toHaveBeenCalledWith({ where: { id: 'problem-1' } });
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 500 when delete flow throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.problem.findUnique.mockRejectedValue(new Error('db failed'));

    const req = new NextRequest('http://localhost/api/problems/problem-1', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(500);
  });
});
