import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
vi.mock('fs', () => ({ existsSync: vi.fn() }));
vi.mock('fs/promises', () => ({ mkdir: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() }));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  uploadLimitMock.mockResolvedValue({ maxBytes: 5 * 1024 * 1024, maxMb: 5 });
});

describe('GET /api/profile', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('returns user profile when authenticated', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      avatar: null,
      role: 'STUDENT',
      timezone: 'UTC',
    });

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'STUDENT',
      timezone: 'UTC',
    });
  });
});

describe('POST /api/profile', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');

    const req = new Request('http://localhost/api/profile', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('returns 400 when name fields missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });

    const formData = new FormData();
    formData.set('firstName', '');
    formData.set('lastName', '');

    const req = new Request('http://localhost/api/profile', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when timezone invalid', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');
    formData.set('timezone', 'Invalid/Zone');

    const req = new Request('http://localhost/api/profile', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('updates user profile and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', avatar: null });
    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'A',
      lastName: 'B',
      avatar: null,
      role: 'STUDENT',
      timezone: 'UTC',
    });

    const formData = new FormData();
    formData.set('firstName', 'A');
    formData.set('lastName', 'B');
    formData.set('timezone', 'UTC');

    const req = new Request('http://localhost/api/profile', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});
