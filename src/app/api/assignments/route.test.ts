import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignment: { create: vi.fn() },
  user: { findUnique: vi.fn() },
  systemSettings: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
const toEndOfDayInTimezoneMock = vi.hoisted(() =>
  vi.fn(() => new Date('2025-01-01T00:00:00.000Z')),
);
const toDateTimeInTimezoneMock = vi.hoisted(() =>
  vi.fn(() => new Date('2025-01-02T00:00:00.000Z')),
);

vi.mock('@/lib/date-utils', () => ({
  toEndOfDayInTimezone: toEndOfDayInTimezoneMock,
  toDateTimeInTimezone: toDateTimeInTimezoneMock,
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/assignments', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments', {
      method: 'POST',
      body: JSON.stringify({ title: 'A', courseId: 'c1' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/assignments', {
      method: 'POST',
      body: JSON.stringify({ title: 'A' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('creates assignment and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.assignment.create.mockResolvedValue({
      id: 'a1',
      title: 'A',
      description: null,
      dueDate: new Date('2025-01-01T00:00:00.000Z'),
      isPublished: false,
      courseId: 'c1',
      allowLateSubmissions: true,
      lateCutoff: new Date('2025-01-02T00:00:00.000Z'),
    });

    const req = new NextRequest('http://localhost/api/assignments', {
      method: 'POST',
      body: JSON.stringify({
        title: 'A',
        courseId: 'c1',
        dueDate: '2025-01-01',
        allowLateSubmissions: true,
        lateCutoff: '2025-01-02T04:00',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(prismaMock.assignment.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('creates a group assignment when isGroup is true', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'UTC' });
    prismaMock.assignment.create.mockResolvedValue({ id: 'a2', title: 'G', dueDate: new Date('2025-01-01T00:00:00.000Z'), isGroup: true, courseId: 'c1' });

    const req = new NextRequest('http://localhost/api/assignments', {
      method: 'POST',
      body: JSON.stringify({ title: 'G', courseId: 'c1', dueDate: '2025-01-01', maxPoints: 10, isGroup: true }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(prismaMock.assignment.create).toHaveBeenCalled();
    const called = prismaMock.assignment.create.mock.calls[0][0];
    expect(called.data.isGroup).toBe(true);
  });
});
