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
  it('returns all non-deleted courses (no roster filter) for an ADMIN', async () => {
    await getCoursesListForUser('admin-1', 'ADMIN');
    expect(whereArg()).toEqual({ deletedAt: null });
  });

  it('embeds only staff (FACULTY/TA) roster rows, not students', async () => {
    // The list renders staff only, so the roster relation is filtered server-side to
    // keep the payload from growing with class size.
    await getCoursesListForUser('admin-1', 'ADMIN');
    const select = prismaMock.course.findMany.mock.calls[0][0].select;
    expect(select.roster.where).toEqual({ role: { in: ['FACULTY', 'TA'] } });
  });

  it('limits a non-admin to enrolled courses that are published OR ones they staff', async () => {
    await getCoursesListForUser('stu-1', 'STUDENT');
    expect(whereArg()).toEqual({
      deletedAt: null,
      // A course the viewer was dropped from (as a student) is excluded from their list.
      roster: { some: { userId: 'stu-1', NOT: { role: 'STUDENT', status: 'DROPPED' } } },
      OR: [
        { isPublished: true },
        { roster: { some: { userId: 'stu-1', role: { in: ['FACULTY', 'TA'] } } } },
      ],
    });
  });

  it('lets FACULTY/TA see their own unpublished courses via the staff OR branch', async () => {
    // The page passes 'STUDENT' for every non-admin, so visibility must come from the
    // per-roster staff branch, not the coarse role argument.
    await getCoursesListForUser('fac-1', 'STUDENT');
    expect(whereArg()).toEqual({
      deletedAt: null,
      roster: { some: { userId: 'fac-1', NOT: { role: 'STUDENT', status: 'DROPPED' } } },
      OR: [
        { isPublished: true },
        { roster: { some: { userId: 'fac-1', role: { in: ['FACULTY', 'TA'] } } } },
      ],
    });
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

  it('gives a student staff names only — no staff emails, no reg code', async () => {
    // Only staff are embedded now (students are filtered out server-side), so this
    // checks that a student viewer still gets staff names but never their emails or
    // the reg code.
    prismaMock.course.findMany.mockResolvedValue([
      courseWith([
        {
          role: 'FACULTY',
          user: { id: 'fac', firstName: 'Fay', lastName: 'F', email: 'fay@x.edu', avatar: null },
        },
        {
          role: 'TA',
          user: { id: 'ta', firstName: 'Tam', lastName: 'T', email: 'ta@x.edu', avatar: null },
        },
      ]),
    ]);

    const [course] = await getCoursesListForUser('me', 'STUDENT');

    expect(course.regCode).toBeNull();
    const serialized = JSON.stringify(course.enrolled);
    expect(serialized).not.toContain('@x.edu'); // no staff emails
    expect(course.enrolled).toContainEqual(
      expect.objectContaining({ firstName: 'Fay', courseRole: 'FACULTY' }),
    );
    expect(course.enrolled).toContainEqual(
      expect.objectContaining({ firstName: 'Tam', courseRole: 'TA' }),
    );
  });

  it('gives a staff member the staff roster + reg code for their own course', async () => {
    prismaMock.course.findMany.mockResolvedValue([
      courseWith([
        {
          role: 'FACULTY',
          user: { id: 'me', firstName: 'Me', lastName: 'F', email: 'me@x.edu', avatar: null },
        },
        {
          role: 'TA',
          user: { id: 'ta', firstName: 'Ta', lastName: 'A', email: 'ta@x.edu', avatar: null },
        },
      ]),
    ]);

    // Non-admin caller, but FACULTY in this course -> unshaped staff data + reg code.
    const [course] = await getCoursesListForUser('me', 'STUDENT');

    expect(course.regCode).toBe('SECRET');
    expect(course.enrolled).toContainEqual(
      expect.objectContaining({ id: 'ta', email: 'ta@x.edu', courseRole: 'TA' }),
    );
  });
});

describe('getCoursesListForUser — which LMS opens a course', () => {
  const course = (ltiLinks: { platform: { name: string } }[]) => ({
    id: 'c1',
    name: 'Theory of Computation',
    code: 'CS301',
    regCode: 'abc',
    semester: 'Fall 2026',
    credits: 3,
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-12-01'),
    registrationOpenAt: null,
    registrationCloseAt: null,
    isPublished: true,
    isArchived: false,
    deletedAt: null,
    timezone: 'America/New_York',
    emptyStringNotation: 'LAMBDA',
    createdAt: new Date('2026-08-01'),
    updatedAt: new Date('2026-08-01'),
    roster: [],
    ltiLinks,
  });

  /**
   * The course table has an LMS column reading `lmsNames`. It was only ever built by
   * `/api/courses`, which that table does not call, so a connected course still read
   * "Not connected" and no amount of connecting it again helped.
   */
  it('names the platforms that open the course', async () => {
    prismaMock.course.findMany.mockResolvedValue([course([{ platform: { name: 'Canvas' } }])]);

    const [listed] = await getCoursesListForUser('admin-1', 'ADMIN');

    expect(listed?.lmsNames).toEqual(['Canvas']);
  });

  it('says nothing rather than undefined when no LMS opens it', async () => {
    prismaMock.course.findMany.mockResolvedValue([course([])]);

    const [listed] = await getCoursesListForUser('admin-1', 'ADMIN');

    // The column renders "Not connected" from an empty list; undefined did the same thing
    // for the wrong reason, which is what hid the bug.
    expect(listed?.lmsNames).toEqual([]);
  });

  it('names a platform once even when it opens the course from several LMS courses', async () => {
    prismaMock.course.findMany.mockResolvedValue([
      course([{ platform: { name: 'Canvas' } }, { platform: { name: 'Canvas' } }]),
    ]);

    const [listed] = await getCoursesListForUser('admin-1', 'ADMIN');

    expect(listed?.lmsNames).toEqual(['Canvas']);
  });

  it('asks the database for the links rather than the whole integration', async () => {
    await getCoursesListForUser('admin-1', 'ADMIN');

    const select = prismaMock.course.findMany.mock.calls[0][0].select;
    expect(select.ltiLinks).toEqual({ select: { platform: { select: { name: true } } } });
  });
});
