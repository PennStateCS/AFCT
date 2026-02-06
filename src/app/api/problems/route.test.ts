import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  problem: {
    create: vi.fn(),
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
  const writeFileSync = vi.fn();
  return {
    ...actual,
    mkdirSync,
    writeFileSync,
    default: {
      ...actual,
      mkdirSync,
      writeFileSync,
    },
  };
});

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  uploadLimitMock.mockResolvedValue({ maxBytes: 5 * 1024 * 1024, maxMb: 5 });
});

describe('POST /api/problems', () => {
  it('returns 403 when not authorized', async () => {
    authMock.mockResolvedValue(null);

    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('description', 'Desc');
    formData.set('type', 'FA');
    formData.set('courseId', 'course-1');

    const req = new Request('http://localhost/api/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });

    const formData = new FormData();
    formData.set('title', 'Problem');

    const req = new Request('http://localhost/api/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 413 when file exceeds limit', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    uploadLimitMock.mockResolvedValue({ maxBytes: 1, maxMb: 0.000001 });

    const file = new File([new Uint8Array([1, 2, 3])], 'file.jff');
    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('description', 'Desc');
    formData.set('type', 'FA');
    formData.set('courseId', 'course-1');
    formData.set('file', file);

    const req = new Request('http://localhost/api/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(413);
  });

  it('creates problem and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.problem.create.mockResolvedValue({ id: 'problem-1' });

    const file = new File([new Uint8Array([1, 2, 3])], 'file.jff');
    const formData = new FormData();
    formData.set('title', 'Problem');
    formData.set('description', 'Desc');
    formData.set('type', 'FA');
    formData.set('courseId', 'course-1');
    formData.set('maxStates', '5');
    formData.set('isDeterministic', 'true');
    formData.set('file', file);

    const req = new Request('http://localhost/api/problems', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(prismaMock.problem.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});
