import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignment: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  roster: { findFirst: vi.fn() },
  assignmentProblem: { findFirst: vi.fn() },
  assignmentGrade: { findFirst: vi.fn() },
  submission: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  systemSettings: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/date-utils', () => ({
  toEndOfDayInTimezone: vi.fn().mockReturnValue(new Date('2025-01-01T00:00:00.000Z')),
}));

import { GET, PUT, PATCH, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/assignments/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 when assignment not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 404 when student cannot access', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: false,
    });

    const req = new NextRequest('http://localhost/api/assignments/a1');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/assignments/[id]', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'A' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('updates assignment and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(null);
    prismaMock.assignmentGrade.findFirst.mockResolvedValue(null);
    prismaMock.assignment.update.mockResolvedValue({ id: 'a1', courseId: 'c1' });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'A', dueDate: '2025-01-01', isPublished: true }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.assignment.update).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});

describe('PATCH /api/assignments/[id]', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'A' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('prevents changing group mode if submissions exist', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.submission.findFirst.mockResolvedValue({ id: 's1' });

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'PATCH',
      body: JSON.stringify({ groupId: 'g1' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/assignments/[id]', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1', {
      method: 'POST',
      body: JSON.stringify({ title: 'A', courseId: 'c1' }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
  });
});
