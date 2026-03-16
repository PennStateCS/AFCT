import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
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

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  bcryptMock.hash.mockResolvedValue('hashed-password');
  prismaMock.systemSettings.findUnique.mockResolvedValue({ id: 1, timezone: 'UTC' });
});

describe('POST /api/users/bulk', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({ rows: [] }),
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('returns 403 for disallowed roles', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({
        rows: [
          {
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
            password: 'StrongPass1!',
          },
        ],
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('allows ADMIN, FACULTY, and TA roles', async () => {
    for (const role of ['ADMIN', 'FACULTY', 'TA'] as const) {
      authMock.mockResolvedValue({ user: { id: 'u1', role } });

      const req = new Request('http://localhost/api/users/bulk', {
        method: 'POST',
        body: JSON.stringify({ rows: [] }),
      });

      const res = await POST(req);

      // Authorized roles get past auth and then fail validation for empty rows.
      expect(res.status).toBe(400);
    }
  });

  it('returns 400 when rows are missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({ rows: [] }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('creates valid users and reports row failures', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing-user' })
      .mockResolvedValueOnce(null);

    prismaMock.user.create
      .mockResolvedValueOnce({ id: 'new-1', email: 'ada@example.com' })
      .mockResolvedValueOnce({ id: 'new-2', email: 'new@example.com' });

    const req = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({
        temporaryPasswords: true,
        rows: [
          {
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
            password: 'StrongPass1!',
          },
          {
            firstName: 'Existing',
            lastName: 'User',
            email: 'exists@example.com',
            password: 'StrongPass1!',
          },
          {
            firstName: 'Missing',
            lastName: '',
            email: 'missing@example.com',
            password: 'StrongPass1!',
          },
          {
            firstName: 'Weak',
            lastName: 'Password',
            email: 'weak@example.com',
            password: 'weak',
          },
          {
            firstName: 'New',
            lastName: 'User',
            email: 'new@example.com',
            password: 'StrongPass1!',
          },
          {
            firstName: 'Dup',
            lastName: 'Batch',
            email: 'new@example.com',
            password: 'StrongPass1!',
          },
        ],
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.summary).toEqual({ total: 6, created: 2, failed: 4 });
    expect(body.created).toEqual([
      { row: 2, email: 'ada@example.com', userId: 'new-1' },
      { row: 6, email: 'new@example.com', userId: 'new-2' },
    ]);
    expect(body.failed).toEqual([
      { row: 3, email: 'exists@example.com', reason: 'Username already exists' },
      { row: 4, email: 'missing@example.com', reason: 'Missing required data' },
      {
        row: 5,
        email: 'weak@example.com',
        reason:
          'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.',
      },
      { row: 7, email: 'new@example.com', reason: 'Username already exists' },
    ]);

    expect(prismaMock.user.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ temporaryPassword: true }),
      }),
    );
    expect(bcryptMock.hash).toHaveBeenCalledTimes(2);
    expect(activityLogMock).toHaveBeenCalled();
  });
});
