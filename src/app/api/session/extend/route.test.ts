import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getTokenMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/session/extend', () => {
  it('returns 401 when no token', async () => {
    getTokenMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/session/extend', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns success when token present', async () => {
    getTokenMock.mockResolvedValue({ sub: 'user-1' });

    const req = new NextRequest('http://localhost/api/session/extend', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 500 when token lookup throws', async () => {
    getTokenMock.mockRejectedValue(new Error('boom'));

    const req = new NextRequest('http://localhost/api/session/extend', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(activityLogMock).toHaveBeenCalled();
  });
});
