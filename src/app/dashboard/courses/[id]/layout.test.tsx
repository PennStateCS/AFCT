import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: {
    findFirst: vi.fn(),
  },
}));
const authMock = vi.hoisted(() => vi.fn());
const canAccessCourseMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/permissions', () => ({ canAccessCourse: canAccessCourseMock }));
vi.mock('@/components/navbar/CourseBreadcrumbSource', () => ({
  __esModule: true,
  default: ({ courseId, courseName }: { courseId: string; courseName: string }) => (
    <div
      data-testid="course-breadcrumb-source"
      data-course-id={courseId}
      data-course-name={courseName}
    />
  ),
}));

import CourseLayout from './layout';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
  canAccessCourseMock.mockResolvedValue(true);
});

describe('CourseLayout', () => {
  it('renders breadcrumb source when course exists', async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: 'c1', name: 'Course One' });

    const result = await CourseLayout({
      params: Promise.resolve({ id: 'c1' }),
      children: <div data-testid="children">Child</div>,
    });

    // Basic contract: Prisma queried with awaited route params.
    expect(prismaMock.course.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', deletedAt: null },
      select: { id: true, name: true },
    });

    const element = result as React.ReactElement<any>;
    expect(element.props.children).toHaveLength(2);
    const sourceNode = element.props.children[0];
    const childNode = element.props.children[1];

    expect(sourceNode.type).toBeDefined();
    expect(sourceNode.props.courseId).toBe('c1');
    expect(sourceNode.props.courseName).toBe('Course One');
    expect(childNode.props['data-testid']).toBe('children');
  });

  it('renders only children when course is not found', async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);

    const result = await CourseLayout({
      params: Promise.resolve({ id: 'missing' }),
      children: <div data-testid="children">Child</div>,
    });

    const element = result as React.ReactElement<any>;
    expect(element.props.children[0]).toBeNull();
    expect(element.props.children[1].props['data-testid']).toBe('children');
  });

  it('does not query or expose the course name to a non-member', async () => {
    // A signed-in user who cannot access the course must not learn its name via
    // the breadcrumb — and we never even query for it.
    canAccessCourseMock.mockResolvedValue(false);

    const result = await CourseLayout({
      params: Promise.resolve({ id: 'c1' }),
      children: <div data-testid="children">Child</div>,
    });

    expect(canAccessCourseMock).toHaveBeenCalledWith({ id: 'u1', isAdmin: false }, 'c1');
    expect(prismaMock.course.findFirst).not.toHaveBeenCalled();

    const element = result as React.ReactElement<any>;
    expect(element.props.children[0]).toBeNull();
    expect(element.props.children[1].props['data-testid']).toBe('children');
  });
});
