import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}));
const bcryptCompareMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('bcrypt', () => ({ default: { compare: bcryptCompareMock } }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'test@example.com',
  password: 'hashed',
  firstName: 'Test',
  lastName: 'User',
  role: 'STUDENT',
  inactive: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/public/login', () => {
  it('returns 400 when credentials missing', async () => {
    const req = new NextRequest('http://localhost/api/public/login', {
      method: 'POST',
      body: JSON.stringify({ email: '', password: '' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 401 when user not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/public/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'bad' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 401 for invalid password', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser());
    bcryptCompareMock.mockResolvedValue(false);

    const req = new NextRequest('http://localhost/api/public/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'bad' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 401 for inactive users', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ inactive: true }));
    bcryptCompareMock.mockResolvedValue(true);

    const req = new NextRequest('http://localhost/api/public/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'pass' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns user for valid login', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser());
    bcryptCompareMock.mockResolvedValue(true);

    const req = new NextRequest('http://localhost/api/public/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'pass' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      user: {
        id: 'u1',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
      },
    });
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 500 when lookup throws', async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error('boom'));

    const req = new NextRequest('http://localhost/api/public/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'pass' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalled();
  });
});
