import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  problem: { create: vi.fn(), findMany: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());
const validateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
vi.mock('@/app/utils/xmlStructureValidate', () => ({ validateStructureXML: validateMock }));
vi.mock('fs', () => ({
  default: { mkdirSync: vi.fn(), writeFileSync: vi.fn() },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
  uploadLimitMock.mockResolvedValue({ maxBytes: 5 * 1024 * 1024, maxMb: 5 });
  validateMock.mockReturnValue({ isValid: true });
});

describe('POST /api/courses/[id]/problems', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('type', 'FA');
    formData.set('file', new File([new Uint8Array([1])], 'file.jff'));

    const req = new NextRequest('http://localhost/api/courses/c1/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const formData = new FormData();
    formData.set('title', 'Problem');

    const req = new NextRequest('http://localhost/api/courses/c1/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 404 when course not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('type', 'FA');
    formData.set('file', new File([new Uint8Array([1])], 'file.jff'));

    const req = new NextRequest('http://localhost/api/courses/c1/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(404);
  });

  it('creates problem and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'c1' });
    prismaMock.problem.create.mockResolvedValue({ id: 'p1', title: 'Problem' });

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('type', 'FA');
    formData.set('file', new File([new Uint8Array([1])], 'file.jff'));

    const req = new NextRequest('http://localhost/api/courses/c1/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(201);
    expect(prismaMock.problem.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 400 when the solution file fails structure validation', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    validateMock.mockReturnValue({ isValid: false, error: 'bad structure' });

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('type', 'FA');
    formData.set('file', new File([new Uint8Array([1])], 'file.jff'));

    const req = new NextRequest('http://localhost/api/courses/c1/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
  });

  it('returns 413 when the file exceeds the upload limit', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    uploadLimitMock.mockResolvedValue({ maxBytes: 0, maxMb: 0 });

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('type', 'FA');
    formData.set('file', new File([new Uint8Array([1, 2, 3])], 'file.jff'));

    const req = new NextRequest('http://localhost/api/courses/c1/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(413);
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
  });

  it('returns 500 and logs when problem creation throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'c1' });
    prismaMock.problem.create.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('type', 'FA');
    formData.set('file', new File([new Uint8Array([1])], 'file.jff'));

    const req = new NextRequest('http://localhost/api/courses/c1/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'PROBLEM_CREATE_ERROR', severity: 'ERROR' }),
    );
  });
});
