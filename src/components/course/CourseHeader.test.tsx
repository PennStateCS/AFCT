/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CourseHeaderContent } from './CourseHeader';
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

vi.mock('@/lib/date-format', () => ({
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
  regCode: 'abcd2345',
  createdAt: new Date('2025-06-01T13:00:00Z'),
  updatedAt: new Date('2025-06-01T13:00:00Z'),
  problems: [],
  assignments: [],
  // Course staff only. Students never reach this payload: the roster tab pages through
  // GET /api/courses/[id]/roster.
  staff: [
    {
      id: 'faculty-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'FACULTY',
      courseRole: 'FACULTY',
    },
  ],
};

describe('CourseHeaderContent', () => {
  it('renders course metadata, status, and staff info for instructors', () => {
    render(<CourseHeaderContent course={mockCourse} isStudent={false} />);

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
    render(<CourseHeaderContent course={mockCourse} isStudent />);

    // Title and badges still render, but the faculty/TA line does not.
    expect(screen.getByText('Software Engineering')).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('omits the TAs label when the course has no TAs', () => {
    render(<CourseHeaderContent course={mockCourse} isStudent={false} />);
    expect(screen.queryByText('TAs:')).not.toBeInTheDocument();
  });

  it('lists TAs when the course has some', () => {
    const withTa: FullCourse = {
      ...mockCourse,
      staff: [
        ...(mockCourse.staff ?? []),
        { id: 'ta-1', firstName: 'Alan', lastName: 'Turing', role: 'STUDENT', courseRole: 'TA' },
      ],
    };
    render(<CourseHeaderContent course={withTa} isStudent={false} />);
    expect(screen.getByText('TAs:')).toBeInTheDocument();
    expect(screen.getByText('Alan Turing')).toBeInTheDocument();
  });

  it('shows the registration code formatted and copies the plain code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CourseHeaderContent course={mockCourse} isStudent={false} />);

    // Displayed grouped as ABCD-2345 for readability.
    expect(screen.getByText('ABCD-2345')).toBeInTheDocument();

    // Copies the plain 8-character code the join endpoint expects.
    fireEvent.click(screen.getByRole('button', { name: /copy registration code/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABCD2345'));
    expect(toastMock.success).toHaveBeenCalled();
  });
});
