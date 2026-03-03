import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
  assignment: { findMany: vi.fn() },
  assignmentProblemGrade: { groupBy: vi.fn() },
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
    expect(prismaMock.roster.findMany).not.toHaveBeenCalled();
  });

  it('returns grade matrix for staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findMany.mockResolvedValue([
      { user: { id: 's1', firstName: 'A', lastName: 'B', email: 's1@example.com', avatar: null }, role: 'STUDENT' },
    ]);
    prismaMock.assignment.findMany.mockResolvedValue([
      { id: 'a1', title: 'A1', maxPoints: 10, dueDate: '2025-01-01' },
    ]);
    prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
      { studentId: 's1', assignmentId: 'a1', _sum: { grade: 95 } },
    ]);

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.students).toEqual([
      { id: 's1', firstName: 'A', lastName: 'B', email: 's1@example.com', avatar: null },
    ]);
    expect(body.assignments).toEqual([
      { id: 'a1', title: 'A1', maxPoints: 10, dueDate: '2025-01-01' },
    ]);
    expect(body.grades).toEqual({ s1: { a1: 95 } });
  });

  it('fills nulls when no gradeRows exist', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findMany.mockResolvedValue([
      { user: { id: 's1', firstName: 'A', lastName: 'B', email: 's1@example.com', avatar: null }, role: 'STUDENT' },
      { user: { id: 's2', firstName: 'C', lastName: 'D', email: 's2@example.com', avatar: null }, role: 'STUDENT' },
    ]);
    prismaMock.assignment.findMany.mockResolvedValue([
      { id: 'a1', title: 'A1', maxPoints: 10, dueDate: '2025-01-01' },
      { id: 'a2', title: 'A2', maxPoints: 20, dueDate: '2025-02-01' },
    ]);
    prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grades).toEqual({
      s1: { a1: null, a2: null },
      s2: { a1: null, a2: null },
    });
  });
});