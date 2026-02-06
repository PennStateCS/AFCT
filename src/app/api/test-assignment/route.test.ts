import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignment: {
    findUnique: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/test-assignment', () => {
  it('returns 400 when id is missing', async () => {
    const req = new NextRequest('http://localhost/api/test-assignment');
    const res = await GET(req);

    expect(res.status).toBe(400);
  });

  it('returns 404 when assignment not found', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/test-assignment?id=a1');
    const res = await GET(req);

    expect(res.status).toBe(404);
  });

  it('returns assignment when found', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      title: 'Assignment 1',
      courseId: 'c1',
      isPublished: true,
      course: { id: 'c1', title: 'Course 1' },
    });

    const req = new NextRequest('http://localhost/api/test-assignment?id=a1');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: 'a1',
      title: 'Assignment 1',
      courseId: 'c1',
      isPublished: true,
      course: { id: 'c1', title: 'Course 1' },
    });
  });
});
