import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The page source uses the automatic JSX runtime; the test transform needs React
// in global scope to render its `<CourseClient />` element.
globalThis.React = React;

const prismaMock = vi.hoisted(() => ({
  course: {
    findUnique: vi.fn(),
  },
}));
const authMock = vi.hoisted(() => vi.fn());
const getCourseRoleMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    // Mirror Next's notFound(): throws a control-flow error that unwinds render.
    throw new Error('NEXT_NOT_FOUND');
  }),
);

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/permissions', () => ({ getCourseRole: getCourseRoleMock }));
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
vi.mock('./CourseClient', () => ({
  __esModule: true,
  default: () => null,
}));

import AdminCoursePage from './page';

// AdminCoursePage returns `<CourseClient initialCourse={...} />` without rendering
// it, so read the payload straight off the element props.
type CourseClientEl = { props: { initialCourse: { enrolled: Array<Record<string, unknown>> } } };
const initialCourseOf = (el: unknown) => (el as CourseClientEl).props.initialCourse;

const faculty = {
  role: 'FACULTY',
  user: { id: 'fac', firstName: 'Fay', lastName: 'Faculty', email: 'fay@x.edu', avatar: null },
};
const student = {
  role: 'STUDENT',
  user: { id: 'stu2', firstName: 'Sam', lastName: 'Student', email: 'sam@x.edu', avatar: null },
};

const courseWith = (roster: unknown[]) => ({
  id: 'c1',
  name: 'Course One',
  code: 'C1',
  regCode: 'REG',
  semester: 'Fall',
  credits: 3,
  startDate: null,
  endDate: null,
  registrationOpenAt: null,
  registrationCloseAt: null,
  isPublished: true,
  isArchived: false,
  emptyStringNotation: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  _count: { assignments: 1, problems: 2, roster: roster.length },
  roster,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminCoursePage access control', () => {
  it('returns notFound without loading the course when the viewer lacks access', async () => {
    authMock.mockResolvedValue({ user: { id: 'stranger', isAdmin: false } });
    getCourseRoleMock.mockResolvedValue(null);

    await expect(AdminCoursePage({ params: Promise.resolve({ id: 'c1' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );

    expect(getCourseRoleMock).toHaveBeenCalledWith('stranger', 'c1');
    // The roster (with other users' data) is never queried for a non-member.
    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('returns notFound for an accessible-but-missing course (e.g. admin, bad id)', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    getCourseRoleMock.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue(null);

    await expect(AdminCoursePage({ params: Promise.resolve({ id: 'missing' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('gives staff the full roster (including classmate emails)', async () => {
    authMock.mockResolvedValue({ user: { id: 'fac', isAdmin: false } });
    getCourseRoleMock.mockResolvedValue('FACULTY');
    prismaMock.course.findUnique.mockResolvedValue(courseWith([faculty, student]));

    const result = await AdminCoursePage({ params: Promise.resolve({ id: 'c1' }) });

    // Staff view: email/select is requested and the student's real identity is present.
    const include = prismaMock.course.findUnique.mock.calls[0][0].include;
    expect(include.roster.select.user.select.email).toBe(true);
    const enrolled = initialCourseOf(result).enrolled;
    expect(enrolled).toContainEqual(expect.objectContaining({ id: 'stu2', email: 'sam@x.edu' }));
  });

  it('gives a student a privacy-safe roster: staff names only, no classmate identity or email', async () => {
    authMock.mockResolvedValue({ user: { id: 'stu2', isAdmin: false } });
    getCourseRoleMock.mockResolvedValue('STUDENT');
    prismaMock.course.findUnique.mockResolvedValue(courseWith([faculty, student]));

    const result = await AdminCoursePage({ params: Promise.resolve({ id: 'c1' }) });

    // Student view: emails are not even selected from the DB.
    const include = prismaMock.course.findUnique.mock.calls[0][0].include;
    expect(include.roster.select.user.select.email).toBe(false);

    const enrolled = initialCourseOf(result).enrolled;
    // No email anywhere, and no classmate (student) name/id leaks.
    expect(JSON.stringify(enrolled)).not.toContain('@x.edu');
    expect(JSON.stringify(enrolled)).not.toContain('Sam');
    expect(JSON.stringify(enrolled)).not.toContain('stu2');
    // Faculty name survives (the UI labels the course with it); students collapse
    // to count-only placeholders.
    expect(enrolled).toContainEqual(
      expect.objectContaining({ firstName: 'Fay', courseRole: 'FACULTY' }),
    );
    expect(enrolled).toContainEqual({ id: '', courseRole: 'STUDENT' });
  });
});
