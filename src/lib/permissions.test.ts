import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  course: { findUnique: vi.fn() },
  groupRoster: { findFirst: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  isAdmin,
  getCourseRole,
  canAccessCourse,
  canManageCourse,
  isCourseArchived,
  staffManagesStudent,
  usersShareGroupInCourse,
  canViewStudentData,
} from './permissions';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isAdmin', () => {
  it('is true only when the flag is set', () => {
    expect(isAdmin({ id: 'u', isAdmin: true })).toBe(true);
    expect(isAdmin({ id: 'u', isAdmin: false })).toBe(false);
    expect(isAdmin({ id: 'u' })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe('getCourseRole', () => {
  it('returns the roster role for the course', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    await expect(getCourseRole('u', 'c')).resolves.toBe('FACULTY');
  });

  it('returns null when the user is not on the roster', async () => {
    prismaMock.roster.findFirst.mockResolvedValue(null);
    await expect(getCourseRole('u', 'c')).resolves.toBeNull();
  });

  it('short-circuits (no DB call) when an id is missing', async () => {
    await expect(getCourseRole(null, 'c')).resolves.toBeNull();
    await expect(getCourseRole('u', undefined)).resolves.toBeNull();
    expect(prismaMock.roster.findFirst).not.toHaveBeenCalled();
  });
});

describe('canAccessCourse', () => {
  it('admins may access any course without a roster lookup', async () => {
    await expect(canAccessCourse({ id: 'a', isAdmin: true }, 'c')).resolves.toBe(true);
    expect(prismaMock.roster.findFirst).not.toHaveBeenCalled();
  });

  it('a student may access an enrolled PUBLISHED course', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({
      role: 'STUDENT',
      course: { isPublished: true },
    });
    await expect(canAccessCourse({ id: 'u', isAdmin: false }, 'c')).resolves.toBe(true);
  });

  it('a student may NOT access an enrolled UNPUBLISHED course', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({
      role: 'STUDENT',
      course: { isPublished: false },
    });
    await expect(canAccessCourse({ id: 'u', isAdmin: false }, 'c')).resolves.toBe(false);
  });

  it('staff (FACULTY/TA) may access their course even while unpublished', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({
      role: 'FACULTY',
      course: { isPublished: false },
    });
    await expect(canAccessCourse({ id: 'u' }, 'c')).resolves.toBe(true);

    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA', course: { isPublished: false } });
    await expect(canAccessCourse({ id: 'u' }, 'c')).resolves.toBe(true);
  });

  it('non-enrolled non-admins may not', async () => {
    prismaMock.roster.findFirst.mockResolvedValue(null);
    await expect(canAccessCourse({ id: 'u' }, 'c')).resolves.toBe(false);
  });

  it('anonymous callers may not', async () => {
    await expect(canAccessCourse(null, 'c')).resolves.toBe(false);
  });
});

describe('canManageCourse', () => {
  it('admins may manage any course', async () => {
    await expect(canManageCourse({ id: 'a', isAdmin: true }, 'c')).resolves.toBe(true);
    expect(prismaMock.roster.findFirst).not.toHaveBeenCalled();
  });

  it('faculty and TAs may manage by default', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });
    await expect(canManageCourse({ id: 'u' }, 'c')).resolves.toBe(true);
  });

  it('students may not manage', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });
    await expect(canManageCourse({ id: 'u' }, 'c')).resolves.toBe(false);
  });

  it('respects a narrower role set (FACULTY only excludes TAs)', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });
    await expect(canManageCourse({ id: 'u' }, 'c', ['FACULTY'])).resolves.toBe(false);
  });
});

describe('isCourseArchived', () => {
  it('is true when the course row is archived', async () => {
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });
    await expect(isCourseArchived('c')).resolves.toBe(true);
  });

  it('is false when not archived or the course is missing', async () => {
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
    await expect(isCourseArchived('c')).resolves.toBe(false);
    prismaMock.course.findUnique.mockResolvedValue(null);
    await expect(isCourseArchived('c')).resolves.toBe(false);
  });
});

describe('staffManagesStudent', () => {
  it('admins manage any account without a lookup', async () => {
    await expect(staffManagesStudent({ id: 'a', isAdmin: true }, 't')).resolves.toBe(true);
    expect(prismaMock.roster.findFirst).not.toHaveBeenCalled();
  });

  it('is true when the target is a STUDENT in a course the caller staffs', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1' });
    await expect(staffManagesStudent({ id: 's' }, 't')).resolves.toBe(true);
    // The query pins the target to a STUDENT roster whose course rosters the caller as staff.
    expect(prismaMock.roster.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 't', role: 'STUDENT' }),
      }),
    );
  });

  it('is false when no such relationship exists', async () => {
    prismaMock.roster.findFirst.mockResolvedValue(null);
    await expect(staffManagesStudent({ id: 's' }, 't')).resolves.toBe(false);
  });

  it('anonymous callers manage no one', async () => {
    await expect(staffManagesStudent(null, 't')).resolves.toBe(false);
    expect(prismaMock.roster.findFirst).not.toHaveBeenCalled();
  });
});

describe('usersShareGroupInCourse', () => {
  it('short-circuits true when both ids are the same', async () => {
    await expect(usersShareGroupInCourse('c', 'u', 'u')).resolves.toBe(true);
    expect(prismaMock.groupRoster.findFirst).not.toHaveBeenCalled();
  });

  it('is true when a shared group exists', async () => {
    prismaMock.groupRoster.findFirst.mockResolvedValue({ id: 'gr1' });
    await expect(usersShareGroupInCourse('c', 'a', 'b')).resolves.toBe(true);
  });

  it('is false when no shared group and when an id is missing', async () => {
    prismaMock.groupRoster.findFirst.mockResolvedValue(null);
    await expect(usersShareGroupInCourse('c', 'a', 'b')).resolves.toBe(false);
    await expect(usersShareGroupInCourse('c', 'a', null)).resolves.toBe(false);
  });
});

describe('canViewStudentData', () => {
  it('admins and staff may view anyone', async () => {
    await expect(canViewStudentData({ id: 'a', isAdmin: true }, 'c', 't')).resolves.toBe(true);
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' }); // canManageCourse → true
    await expect(canViewStudentData({ id: 's' }, 'c', 't')).resolves.toBe(true);
  });

  it('a student may view their own data', async () => {
    await expect(canViewStudentData({ id: 'u' }, 'c', 'u')).resolves.toBe(true);
  });

  it('a non-staff student may not view another student on an individual assignment', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' }); // not staff
    await expect(canViewStudentData({ id: 'u' }, 'c', 'other')).resolves.toBe(false);
  });

  it('a groupmate may view shared work on a group assignment', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' }); // not staff
    prismaMock.groupRoster.findFirst.mockResolvedValue({ id: 'gr1' }); // same group
    await expect(
      canViewStudentData({ id: 'u' }, 'c', 'mate', { groupAssignment: true }),
    ).resolves.toBe(true);
  });
});
