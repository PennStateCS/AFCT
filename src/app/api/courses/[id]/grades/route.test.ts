import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
  assignment: { findMany: vi.fn() },
  assignmentGrade: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses/[id]/grades', () => {
  it('returns 400 when course ID missing', async () => {
    const req = new NextRequest('http://localhost/api/courses//grades');
    const res = await GET(req, { params: Promise.resolve({ id: '' }) });

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when role is not allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('returns grade matrix for staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findMany.mockResolvedValue([
      {
        user: {
          id: 's1',
          firstName: 'A',
          lastName: 'B',
          email: 's1@example.com',
          avatar: null,
        },
      },
    ]);
    prismaMock.assignment.findMany.mockResolvedValue([
      { id: 'a1', dueDate: new Date('2025-01-01T00:00:00.000Z') },
    ]);
    prismaMock.assignmentGrade.findMany.mockResolvedValue([
      { studentId: 's1', assignmentId: 'a1', grade: 95 },
    ]);

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.students).toEqual([
      { id: 's1', firstName: 'A', lastName: 'B', email: 's1@example.com', avatar: null },
    ]);
    expect(body.assignments).toEqual([{ id: 'a1', dueDate: '2025-01-01T00:00:00.000Z' }]);
    expect(body.grades).toEqual({ s1: { a1: 95 } });
  });
});
