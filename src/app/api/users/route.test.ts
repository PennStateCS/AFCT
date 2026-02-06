import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  systemSettings: {
    findUnique: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const bcryptMock = vi.hoisted(() => ({ hash: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('bcrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcrypt')>();
  return {
    ...actual,
    ...bcryptMock,
    default: {
      ...actual,
      ...bcryptMock,
    },
  };
});

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  bcryptMock.hash.mockResolvedValue('hashed');
});

describe('GET /api/users', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/users'));

    expect(res.status).toBe(403);
  });

  it('returns users and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u2', email: 'u2@example.com' }]);

    const res = await GET(new Request('http://localhost/api/users?role=STUDENT'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'u2', email: 'u2@example.com' }]);
    expect(activityLogMock).toHaveBeenCalled();
  });
});

describe('POST /api/users', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        firstName: 'A',
        lastName: 'B',
        password: 'Strong1!a',
        role: 'STUDENT',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new Request('http://localhost/api/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when email invalid', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new Request('http://localhost/api/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'bad-email',
        firstName: 'A',
        lastName: 'B',
        password: 'Strong1!a',
        role: 'STUDENT',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when password weak', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new Request('http://localhost/api/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        firstName: 'A',
        lastName: 'B',
        password: 'weak',
        role: 'STUDENT',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 409 when email already exists', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u2' });

    const req = new Request('http://localhost/api/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        firstName: 'A',
        lastName: 'B',
        password: 'Strong1!a',
        role: 'STUDENT',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(409);
  });

  it('returns 400 when timezone invalid', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        firstName: 'A',
        lastName: 'B',
        password: 'Strong1!a',
        role: 'STUDENT',
        timezone: 'Bad/Zone',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('creates user and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.systemSettings.findUnique.mockResolvedValue({ id: 1, timezone: 'UTC' });
    prismaMock.user.create.mockResolvedValue({ id: 'u2', email: 'test@example.com' });

    const req = new Request('http://localhost/api/users', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        firstName: 'A',
        lastName: 'B',
        password: 'Strong1!a',
        role: 'STUDENT',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});
