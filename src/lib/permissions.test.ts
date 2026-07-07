import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { isAdmin, getCourseRole, canAccessCourse, canManageCourse } from './permissions';

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

  it('enrolled non-admins may access it', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });
    await expect(canAccessCourse({ id: 'u', isAdmin: false }, 'c')).resolves.toBe(true);
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
