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
const canAccessCourseMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    // Mirror Next's notFound(): throws a control-flow error that unwinds render.
    throw new Error('NEXT_NOT_FOUND');
  }),
);

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/permissions', () => ({ canAccessCourse: canAccessCourseMock }));
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
vi.mock('./CourseClient', () => ({
  __esModule: true,
  default: () => null,
}));

import AdminCoursePage from './page';

const rosterUser = {
  id: 'other',
  firstName: 'Other',
  lastName: 'Person',
  email: 'other@example.com',
  avatar: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdminCoursePage access control', () => {
  it('returns notFound without loading the course when the viewer lacks access', async () => {
    authMock.mockResolvedValue({ user: { id: 'stranger', isAdmin: false } });
    canAccessCourseMock.mockResolvedValue(false);

    await expect(AdminCoursePage({ params: Promise.resolve({ id: 'c1' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );

    expect(canAccessCourseMock).toHaveBeenCalledWith({ id: 'stranger', isAdmin: false }, 'c1');
    // The roster (with other users' emails) is never queried for a non-member.
    expect(prismaMock.course.findUnique).not.toHaveBeenCalled();
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('returns notFound for an accessible-but-missing course (e.g. admin, bad id)', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    canAccessCourseMock.mockResolvedValue(true);
    prismaMock.course.findUnique.mockResolvedValue(null);

    await expect(AdminCoursePage({ params: Promise.resolve({ id: 'missing' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('renders the course for a member', async () => {
    authMock.mockResolvedValue({ user: { id: 'other', isAdmin: false } });
    canAccessCourseMock.mockResolvedValue(true);
    prismaMock.course.findUnique.mockResolvedValue({
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
      _count: { assignments: 1, problems: 2, roster: 1 },
      roster: [{ role: 'STUDENT', user: rosterUser }],
    });

    const result = await AdminCoursePage({ params: Promise.resolve({ id: 'c1' }) });

    expect(notFoundMock).not.toHaveBeenCalled();
    // The success path renders CourseClient (mocked) rather than throwing.
    expect(result).not.toBeNull();
  });
});
