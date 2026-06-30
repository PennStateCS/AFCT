import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  assignment: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses/[id]/assignments', () => {
  it('returns 400 when courseId missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });

    const req = new NextRequest('http://localhost/api/courses//assignments');
    const res = await GET(req, { params: Promise.resolve({ id: '' }) });

    expect(res.status).toBe(400);
  });

  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/assignments');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 404 when course not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/assignments');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(404);
  });

  it('returns assignments with grade totals', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.course.findUnique.mockResolvedValue({ id: 'c1' });
    // include problems needed for grade math
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'A',
        dueDate: new Date('2025-01-01T00:00:00Z'),
        description: null,
        problems: [
          {
            maxPoints: 10,
            grades: [{ grade: 7 }],
          },
          {
            maxPoints: 5,
            grades: [{ grade: 3 }],
          },
        ],
      },
    ]);

    const req = new NextRequest('http://localhost/api/courses/c1/assignments', {
      headers: { authorization: 'Bearer test-token' },
    });
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: 'a1',
        title: 'A',
        dueDate: new Date('2025-01-01T00:00:00.000Z').toISOString(),
        description: null,
        totalGrade: 10,
        maxGrade: 15,
      },
    ]);
  });
});
