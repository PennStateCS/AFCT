import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: {
    findUnique: vi.fn(),
  },
  roster: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/courses/join', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when code is invalid', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });

    const req = new Request('http://localhost/api/courses/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'AB' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 when course not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 403 for faculty/admin when course is unpublished', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'FACULTY' } });
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'course-1',
      name: 'Course 1',
      regCode: 'ABC123',
      isPublished: false,
      isArchived: false,
    });

    const req = new Request('http://localhost/api/courses/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 404 for students when course is unpublished', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'course-1',
      name: 'Course 1',
      regCode: 'ABC123',
      isPublished: false,
      isArchived: false,
    });

    const req = new Request('http://localhost/api/courses/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 400 when admin tries to join', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'ADMIN' } });
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'course-1',
      name: 'Course 1',
      regCode: 'ABC123',
      isPublished: true,
      isArchived: false,
    });
    prismaMock.roster.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when already enrolled', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'course-1',
      name: 'Course 1',
      regCode: 'ABC123',
      isPublished: true,
      isArchived: false,
    });
    prismaMock.roster.findUnique.mockResolvedValue({ role: 'STUDENT' });

    const req = new Request('http://localhost/api/courses/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('creates roster entry for student', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', role: 'STUDENT' } });
    prismaMock.course.findUnique.mockResolvedValue({
      id: 'course-1',
      name: 'Course 1',
      regCode: 'ABC123',
      isPublished: true,
      isArchived: false,
    });
    prismaMock.roster.findUnique.mockResolvedValue(null);
    prismaMock.roster.create.mockResolvedValue({ id: 'roster-1' });

    const req = new Request('http://localhost/api/courses/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'ABC123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(prismaMock.roster.create).toHaveBeenCalledWith({
      data: { courseId: 'course-1', userId: 'user-1', role: 'STUDENT' },
    });
  });
});
