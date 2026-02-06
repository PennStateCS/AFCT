import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses/[id]/[aid]', () => {
  it('returns 404 when assignment not found', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/c1/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns assignment details', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Assignment',
      problems: [
        {
          problem: {
            id: 'p1',
            title: 'P1',
            description: null,
            type: null,
            maxStates: null,
            isDeterministic: null,
            fileName: null,
            originalFileName: null,
          },
        },
      ],
      course: {
        name: 'Course',
        code: 'C1',
        isArchived: false,
        roster: [{ role: 'FACULTY', user: { id: 'u1', firstName: 'A', lastName: 'B' } }],
      },
    });

    const res = await GET(new Request('http://localhost/api/courses/c1/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.course.code).toBe('C1');
    expect(body.problems).toHaveLength(1);
  });
});
