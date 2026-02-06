import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET, PUT } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/system-settings', () => {
  it('returns 403 when not authorized', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(403);
  });

  it('returns settings with defaults', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ timezone: 'UTC', maxUploadSizeMb: 25 });
  });

  it('returns stored settings', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      id: 1,
      timezone: 'America/New_York',
      maxUploadSizeMb: 100,
    });

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ timezone: 'America/New_York', maxUploadSizeMb: 100 });
  });
});

describe('PUT /api/system-settings', () => {
  it('returns 403 when not authorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      body: JSON.stringify({ timezone: 'UTC', maxUploadSizeMb: 50 }),
    });

    const res = await PUT(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid JSON body', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid timezone', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      body: JSON.stringify({ timezone: 'Bad/Zone', maxUploadSizeMb: 10 }),
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  it('upserts settings and clamps size', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.systemSettings.upsert.mockResolvedValue({
      id: 1,
      timezone: 'UTC',
      maxUploadSizeMb: 1,
    });

    const req = new Request('http://localhost/api/system-settings', {
      method: 'PUT',
      body: JSON.stringify({ timezone: 'UTC', maxUploadSizeMb: -5 }),
    });

    const res = await PUT(req);

    expect(res.status).toBe(200);
    expect(prismaMock.systemSettings.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: { timezone: 'UTC', maxUploadSizeMb: 1 },
      create: { id: 1, timezone: 'UTC', maxUploadSizeMb: 1 },
    });
  });
});
