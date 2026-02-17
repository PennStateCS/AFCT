/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CourseHeader } from './CourseHeader';
import type { FullCourse } from '@/types/course';

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/course-status', () => ({
  getCourseStatusTag: () => ({ status: 'Open', bgColor: 'bg-green-500' }),
}));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'America/New_York' }),
}));

vi.mock('@/lib/date', () => ({
  formatDateTimeInTimeZone: (value: Date | string) =>
    typeof value === 'string' ? value : value.toISOString(),
}));

const mockCourse: FullCourse = {
  id: 'course-1',
  code: 'CMPSC 431',
  name: 'Software Engineering',
  semester: 'Fall 2025',
  credits: 3,
  startDate: new Date('2025-08-20T13:00:00Z'),
  endDate: new Date('2025-12-10T13:00:00Z'),
  registrationOpenAt: new Date('2025-06-01T13:00:00Z'),
  registrationCloseAt: new Date('2025-08-15T13:00:00Z'),
  isPublished: true,
  isArchived: false,
  regCode: 'abc123',
  problems: [],
  assignments: [],
  enrolled: [
    {
      id: 'faculty-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'FACULTY',
      courseRole: 'FACULTY',
    },
    {
      id: 'student-1',
      firstName: 'Grace',
      lastName: 'Hopper',
      role: 'STUDENT',
      courseRole: 'STUDENT',
    },
  ],
};

const onEditClick = vi.fn();
const onDuplicate = vi.fn();
const onPublishToggle = vi.fn();
const onArchiveToggle = vi.fn();

beforeEach(() => {
  onEditClick.mockReset();
  onDuplicate.mockReset();
  onPublishToggle.mockReset();
  onArchiveToggle.mockReset();
});

describe('CourseHeader', () => {
  it('renders course metadata and staff info for instructors', () => {
    render(
      <CourseHeader
        course={mockCourse}
        isStudent={false}
        onEditClick={onEditClick}
        onDuplicate={onDuplicate}
        onPublishToggle={onPublishToggle}
        onArchiveToggle={onArchiveToggle}
      />,
    );

    expect(screen.getByText(/CMPSC 431/)).toBeInTheDocument();
    expect(screen.getByText('Software Engineering')).toBeInTheDocument();
    expect(screen.getByText('Fall 2025')).toBeInTheDocument();
    expect(screen.getByText('3 credits')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Course' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate Course' })).toBeInTheDocument();
  });

  it('hides instructor actions for students', () => {
    render(
      <CourseHeader
        course={mockCourse}
        isStudent
        onEditClick={onEditClick}
        onDuplicate={onDuplicate}
        onPublishToggle={onPublishToggle}
        onArchiveToggle={onArchiveToggle}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Edit Course' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duplicate Course' })).toBeNull();
  });

  it('calls the appropriate callbacks when toggles and actions are used', async () => {
    const user = userEvent.setup();

    render(
      <CourseHeader
        course={mockCourse}
        isStudent={false}
        onEditClick={onEditClick}
        onDuplicate={onDuplicate}
        onPublishToggle={onPublishToggle}
        onArchiveToggle={onArchiveToggle}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit Course' }));
    expect(onEditClick).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Duplicate Course' }));
    expect(onDuplicate).toHaveBeenCalledTimes(1);

    const switches = screen.getAllByRole('switch');
    await user.click(switches[0]);
    await user.click(switches[1]);

    expect(onPublishToggle).toHaveBeenCalled();
    expect(onArchiveToggle).toHaveBeenCalled();
  });
});
