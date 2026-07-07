import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
});

describe('GET /api/courses/[id]/[aid]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/c1/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-staff user is not enrolled', async () => {
    authMock.mockResolvedValue({ user: { id: 'stranger', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/c1/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(403);
  });

  it('allows an enrolled student', async () => {
    authMock.mockResolvedValue({ user: { id: 'stu-1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1' });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Assignment',
      problems: [],
      course: { name: 'Course', code: 'C1', isArchived: false },
    });

    const res = await GET(new Request('http://localhost/api/courses/c1/a1?view=problems'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(200);
  });

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

  it('omits roster for non-full views', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Assignment',
      problems: [],
      course: {
        name: 'Course',
        code: 'C1',
        isArchived: false,
        roster: [{ role: 'FACULTY', user: { id: 'u1', firstName: 'A', lastName: 'B' } }],
      },
    });

    const res = await GET(new Request('http://localhost/api/courses/c1/a1?view=problems'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.course.roster).toBeUndefined();
  });

  it('treats non-finite problem points as zero', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      title: 'Assignment',
      problems: [
        {
          maxPoints: NaN,
          maxSubmissions: 1,
          autograderEnabled: false,
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
        roster: [],
      },
    });

    const res = await GET(new Request('http://localhost/api/courses/c1/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxPoints).toBe(0);
  });

  it('returns 500 when assignment query throws', async () => {
    prismaMock.assignment.findFirst.mockRejectedValue(new Error('db down'));

    const res = await GET(new Request('http://localhost/api/courses/c1/a1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1' }),
    });

    expect(res.status).toBe(500);
  });
});
