import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: {
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getCoursesListForUser } from '@/lib/courses-list';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.course.findMany.mockResolvedValue([]);
});

const whereArg = () => prismaMock.course.findMany.mock.calls[0][0].where;

describe('getCoursesListForUser — access scoping', () => {
  it('returns all courses (no roster filter) for an ADMIN', async () => {
    await getCoursesListForUser('admin-1', 'ADMIN');
    expect(whereArg()).toEqual({});
  });

  it('limits a STUDENT to enrolled AND published courses', async () => {
    await getCoursesListForUser('stu-1', 'STUDENT');
    expect(whereArg()).toEqual({
      roster: { some: { userId: 'stu-1' } },
      isPublished: true,
    });
  });

  it('limits FACULTY/TA to enrolled courses without the published filter', async () => {
    await getCoursesListForUser('fac-1', 'FACULTY');
    expect(whereArg()).toEqual({ roster: { some: { userId: 'fac-1' } } });
  });
});

describe('getCoursesListForUser — roster→enrolled mapping', () => {
  it('flattens each roster entry into an enrolled member with course + global roles', async () => {
    prismaMock.course.findMany.mockResolvedValue([
      {
        id: 'c1',
        name: 'Automata',
        code: 'CS301',
        regCode: 'ABC',
        semester: 'Fall',
        credits: 3,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-05-01'),
        registrationOpenAt: null,
        registrationCloseAt: null,
        isPublished: true,
        isArchived: false,
        emptyStringNotation: 'EMPTY',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
        roster: [
          {
            role: 'TA',
            user: {
              id: 'u1',
              firstName: 'Ada',
              lastName: 'Lovelace',
              email: 'ada@example.com',
              avatar: null,
              role: 'STUDENT',
            },
          },
        ],
      },
    ]);

    const [course] = await getCoursesListForUser('admin-1', 'ADMIN');
    expect(course.id).toBe('c1');
    expect(course.enrolled).toEqual([
      {
        id: 'u1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        avatar: null,
        role: 'STUDENT', // global role
        courseRole: 'TA', // per-course role
      },
    ]);
  });

  it('orders by creation date descending', async () => {
    await getCoursesListForUser('admin-1', 'ADMIN');
    expect(prismaMock.course.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });
});

describe('getCoursesListForUser — roster shaping by the viewer’s per-course role', () => {
  const courseWith = (roster: unknown[]) => ({
    id: 'c1',
    name: 'X',
    code: 'C',
    regCode: 'SECRET',
    semester: 'Fall',
    credits: 3,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-05-01'),
    registrationOpenAt: null,
    registrationCloseAt: null,
    isPublished: true,
    isArchived: false,
    emptyStringNotation: 'EMPTY',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    roster,
  });

  it('gives a student staff names only — no classmate emails, no reg code', async () => {
    prismaMock.course.findMany.mockResolvedValue([
      courseWith([
        {
          role: 'FACULTY',
          user: { id: 'fac', firstName: 'Fay', lastName: 'F', email: 'fay@x.edu', avatar: null },
        },
        {
          role: 'STUDENT',
          user: { id: 'me', firstName: 'Me', lastName: 'S', email: 'me@x.edu', avatar: null },
        },
        {
          role: 'STUDENT',
          user: { id: 'peer', firstName: 'Peer', lastName: 'P', email: 'peer@x.edu', avatar: null },
        },
      ]),
    ]);

    const [course] = await getCoursesListForUser('me', 'STUDENT');

    expect(course.regCode).toBeNull();
    const serialized = JSON.stringify(course.enrolled);
    expect(serialized).not.toContain('@x.edu'); // no emails
    expect(serialized).not.toContain('Peer'); // no classmate name
    expect(course.enrolled).toContainEqual(
      expect.objectContaining({ firstName: 'Fay', courseRole: 'FACULTY' }),
    );
    // Both students survive as count-only placeholders.
    expect(course.enrolled?.filter((m) => m.courseRole === 'STUDENT')).toHaveLength(2);
  });

  it('gives a faculty member the full roster + reg code for their own course', async () => {
    prismaMock.course.findMany.mockResolvedValue([
      courseWith([
        {
          role: 'FACULTY',
          user: { id: 'me', firstName: 'Me', lastName: 'F', email: 'me@x.edu', avatar: null },
        },
        {
          role: 'STUDENT',
          user: { id: 'stu', firstName: 'Stu', lastName: 'S', email: 'stu@x.edu', avatar: null },
        },
      ]),
    ]);

    // Non-admin caller, but FACULTY in this course -> full data (per-course role).
    const [course] = await getCoursesListForUser('me', 'STUDENT');

    expect(course.regCode).toBe('SECRET');
    expect(course.enrolled).toContainEqual(
      expect.objectContaining({ id: 'stu', email: 'stu@x.edu' }),
    );
  });
});
