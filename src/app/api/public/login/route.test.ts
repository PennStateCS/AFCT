import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authenticateUserMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/app/services/authService', () => ({ authenticateUser: authenticateUserMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { POST } from './route';

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

  it('returns 401 for invalid credentials', async () => {
    authenticateUserMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/public/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'bad' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 401 for inactive users', async () => {
    authenticateUserMock.mockResolvedValue({
      token: 'token',
      user: {
        id: 'u1',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        inactive: true,
      },
    });

    const req = new NextRequest('http://localhost/api/public/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'pass' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns token and user for valid login', async () => {
    authenticateUserMock.mockResolvedValue({
      token: 'token',
      user: {
        id: 'u1',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'STUDENT',
        inactive: false,
      },
    });

    const req = new NextRequest('http://localhost/api/public/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'pass' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      token: 'token',
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

  it('returns 500 when auth throws', async () => {
    authenticateUserMock.mockRejectedValue(new Error('boom'));

    const req = new NextRequest('http://localhost/api/public/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com', password: 'pass' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalled();
  });
});
