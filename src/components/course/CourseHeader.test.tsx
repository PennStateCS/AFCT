/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CourseHeader } from './CourseHeader';
import type { FullCourse } from '@/types/course';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showToast: toastMock }));

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
  deletedAt: null,
  timezone: 'America/New_York',
  emptyStringNotation: 'EPSILON',
  regCode: 'abc123',
  createdAt: new Date('2025-06-01T13:00:00Z'),
  updatedAt: new Date('2025-06-01T13:00:00Z'),
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

describe('CourseHeader', () => {
  it('renders course metadata, status, and staff info for instructors', () => {
    render(<CourseHeader course={mockCourse} isStudent={false} />);

    expect(screen.getByText(/CMPSC 431/)).toBeInTheDocument();
    expect(screen.getByText('Software Engineering')).toBeInTheDocument();
    expect(screen.getByText('Fall 2025')).toBeInTheDocument();
    expect(screen.getByText('3 credits')).toBeInTheDocument();
    // Course status badge lives next to the metadata badges.
    expect(screen.getByText(/^(Open|Upcoming|Closed)$/)).toBeInTheDocument();
    // Faculty/TA line is instructor-only.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('hides the staff/date line for students', () => {
    render(<CourseHeader course={mockCourse} isStudent />);

    // Title and badges still render, but the faculty/TA line does not.
    expect(screen.getByText('Software Engineering')).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('omits the TAs label when the course has no TAs', () => {
    render(<CourseHeader course={mockCourse} isStudent={false} />);
    expect(screen.queryByText('TAs:')).not.toBeInTheDocument();
  });

  it('lists TAs when the course has some', () => {
    const withTa: FullCourse = {
      ...mockCourse,
      enrolled: [
        ...mockCourse.enrolled,
        { id: 'ta-1', firstName: 'Alan', lastName: 'Turing', role: 'STUDENT', courseRole: 'TA' },
      ],
    };
    render(<CourseHeader course={withTa} isStudent={false} />);
    expect(screen.getByText('TAs:')).toBeInTheDocument();
    expect(screen.getByText('Alan Turing')).toBeInTheDocument();
  });

  it('shows the join code formatted and copies the plain code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CourseHeader course={mockCourse} isStudent={false} />);

    // Displayed grouped as ABC-123 for readability.
    expect(screen.getByText('ABC-123')).toBeInTheDocument();

    // Copies the plain 6-character code the join endpoint expects.
    fireEvent.click(screen.getByRole('button', { name: /copy join code/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABC123'));
    expect(toastMock.success).toHaveBeenCalled();
  });
});
