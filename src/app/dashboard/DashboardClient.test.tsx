/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DashboardClient from './DashboardClient';

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));
vi.mock('@/lib/date', () => ({ formatDateTimeInTimeZone: () => 'DATE' }));
vi.mock('@/lib/course-status', () => ({
  getCourseStatusTag: () => ({ status: 'Open', variant: 'success' }),
}));
vi.mock('@/lib/course-utils', () => ({
  getStudentCount: () => 3,
  formatInstructorNames: () => 'Prof X',
  getTAs: () => [],
}));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

type CourseInput = Parameters<typeof DashboardClient>[0]['courses'][number];

const course = (over: Partial<CourseInput> & { id: string; name: string }): CourseInput =>
  ({
    code: 'C',
    semester: 'F25',
    credits: 3,
    startDate: '2025-01-01T00:00:00.000Z',
    endDate: '2099-01-01T00:00:00.000Z',
    isPublished: true,
    isArchived: false,
    enrolled: [],
    ...over,
  }) as CourseInput;

const renderDash = (courses: CourseInput[], isAdmin = false) =>
  render(
    <DashboardClient sessionUser={{ id: 'u1', isAdmin }} title="Current Courses" courses={courses} />,
  );

describe('DashboardClient per-course role', () => {
  it('a student sees only published courses and no enrollment count', () => {
    renderDash([
      course({ id: 'pub', name: 'Published Course', isPublished: true, userRole: 'STUDENT' }),
      course({ id: 'unpub', name: 'Hidden Course', isPublished: false, userRole: 'STUDENT' }),
    ]);

    expect(screen.getByText('Published Course')).toBeInTheDocument();
    expect(screen.queryByText('Hidden Course')).not.toBeInTheDocument();
    expect(screen.queryByText('Enrollment:')).not.toBeInTheDocument();
  });

  it('a non-admin faculty member sees their own unpublished course and its enrollment', () => {
    renderDash([
      course({ id: 'f', name: 'Faculty Course', isPublished: false, userRole: 'FACULTY' }),
    ]);

    expect(screen.getByText('Faculty Course')).toBeInTheDocument();
    expect(screen.getByText('Enrollment:')).toBeInTheDocument();
  });

  it('a TA likewise sees their unpublished course and its enrollment', () => {
    renderDash([course({ id: 't', name: 'TA Course', isPublished: false, userRole: 'TA' })]);

    expect(screen.getByText('TA Course')).toBeInTheDocument();
    expect(screen.getByText('Enrollment:')).toBeInTheDocument();
  });

  it('a system admin sees an unpublished course + enrollment regardless of course role', () => {
    renderDash(
      [course({ id: 'a', name: 'Admin View Course', isPublished: false, userRole: 'STUDENT' })],
      true,
    );

    expect(screen.getByText('Admin View Course')).toBeInTheDocument();
    expect(screen.getByText('Enrollment:')).toBeInTheDocument();
  });
});
