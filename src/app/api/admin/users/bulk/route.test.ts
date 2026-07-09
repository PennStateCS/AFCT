import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
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
  // No pre-existing emails by default; the batched existence check returns none.
  prismaMock.user.findMany.mockResolvedValue([]);
});

describe('POST /api/users/bulk', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({ rows: [] }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
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

  it('allows admins (past auth, then validation) and denies non-admins', async () => {
    // Admin gets past auth and fails validation on empty rows.
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    const adminReq = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({ rows: [] }),
    });
    expect((await POST(adminReq)).status).toBe(400);

    // Non-admins (including faculty/TA) can no longer bulk-create users.
    for (const role of ['FACULTY', 'TA', 'STUDENT'] as const) {
      authMock.mockResolvedValue({ user: { id: 'u1', role } });
      const req = new Request('http://localhost/api/users/bulk', {
        method: 'POST',
        body: JSON.stringify({ rows: [] }),
      });
      expect((await POST(req)).status).toBe(403);
    }
  });

  it('returns 400 when rows are missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({ rows: [] }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('creates valid users and reports row failures', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    // One batched existence check: only exists@example.com is already taken.
    prismaMock.user.findMany.mockResolvedValue([{ email: 'exists@example.com' }]);

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

  it('rejects a row with an invalid email format', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({
        rows: [
          {
            rowNumber: 9,
            firstName: 'Bad',
            lastName: 'Email',
            email: 'not-an-email',
            password: 'StrongPass1!',
          },
        ],
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual({ total: 1, created: 0, failed: 1 });
    expect(body.failed).toEqual([
      { row: 9, email: 'not-an-email', reason: 'Invalid email format' },
    ]);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('records a per-row failure when user creation throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.user.create.mockRejectedValueOnce(new Error('unique constraint'));

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

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual({ total: 1, created: 0, failed: 1 });
    expect(body.failed).toEqual([
      { row: 2, email: 'ada@example.com', reason: 'Failed to create user' },
    ]);
  });

  it('returns 400 when the body omits the rows key entirely', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('falls back to UTC and tolerates null/blank rows when settings are missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    // No system settings row -> defaultTimezone falls back to UTC.
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValueOnce({ id: 'new-1', email: 'good@example.com' });

    const req = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({
        rows: [
          // A null row element -> coalesced to {}, then fails on missing data.
          null,
          // Every field absent -> nullish fallbacks kick in; email becomes null.
          {},
          {
            firstName: 'Good',
            lastName: 'User',
            email: 'good@example.com',
            password: 'StrongPass1!',
          },
        ],
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual({ total: 3, created: 1, failed: 2 });
    // The blank rows report email: null (the `email || null` false branch).
    expect(body.failed).toEqual([
      { row: 2, email: null, reason: 'Missing required data' },
      { row: 3, email: null, reason: 'Missing required data' },
    ]);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ timezone: 'UTC' }),
      }),
    );
  });

  it('skips the existence query when no row carries a usable email', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      body: JSON.stringify({
        rows: [{ firstName: 'No', lastName: 'Email', password: 'StrongPass1!' }],
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual({ total: 1, created: 0, failed: 1 });
    // With no candidate emails, the batched existence query is never run.
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('returns 500 with "unknown error" when a non-Error value is thrown', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.systemSettings.findUnique.mockRejectedValueOnce('a plain string');

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

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'USER_BULK_CREATE_ERROR',
        metadata: expect.objectContaining({ error: 'unknown error' }),
      }),
    );
  });

  it('returns 500 and logs an error when the request body is not valid JSON', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const req = new Request('http://localhost/api/users/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal Server Error');
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      req,
      expect.objectContaining({
        action: 'USER_BULK_CREATE_ERROR',
        severity: 'ERROR',
      }),
    );
  });
});
