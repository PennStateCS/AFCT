/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DueDateModule } from './DueDateModule';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'America/New_York' }),
}));

vi.mock('@/lib/date', () => ({
  formatDateTimeInTimeZone: (value: Date | string) =>
    typeof value === 'string' ? value : value.toISOString(),
}));

describe('DueDateModule', () => {
  it('renders a none state when there are no upcoming assignments', () => {
    render(<DueDateModule assignments={[]} />);

    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('sorts and displays upcoming assignments with links', () => {
    const assignments = [
      { id: 'a2', title: 'Project', dueDate: '2025-03-02T12:00:00Z', courseId: 'course-1' },
      { id: 'a1', title: 'Quiz', dueDate: '2025-03-01T12:00:00Z', courseId: 'course-1' },
      { id: 'a3', title: 'Exam', dueDate: '2025-02-01T12:00:00Z', courseId: 'course-1' },
    ];

    vi.setSystemTime(new Date('2025-02-28T12:00:00Z'));

    render(<DueDateModule assignments={assignments} />);

    const rows = screen.getAllByRole('link');
    expect(rows[0]).toHaveTextContent('Quiz');
    expect(rows[1]).toHaveTextContent('Project');
    expect(rows).toHaveLength(2);
  });

  it('labels a row with its course code when the feed provides one', () => {
    vi.setSystemTime(new Date('2025-02-28T12:00:00Z'));

    render(
      <DueDateModule
        assignments={[
          {
            id: 'a1',
            title: 'Lab 3',
            dueDate: '2025-03-01T12:00:00Z',
            courseId: 'course-1',
            course: { code: 'CMPEN 331' },
          },
        ]}
      />,
    );

    expect(screen.getByText('CMPEN 331')).toBeInTheDocument();
  });

  it('caps the list at five and links the rest to the calendar', () => {
    vi.setSystemTime(new Date('2025-02-28T12:00:00Z'));
    const assignments = Array.from({ length: 7 }, (_, i) => ({
      id: `a${i}`,
      title: `HW ${i}`,
      dueDate: `2025-03-0${i + 1}T12:00:00Z`,
      courseId: 'course-1',
    }));

    render(<DueDateModule assignments={assignments} />);

    // 5 assignment links + the "more on the calendar" link.
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(6);
    const more = screen.getByText('2 more on the calendar');
    expect(more).toHaveAttribute('href', '/dashboard/calendar');
  });

  it('marks a draft assignment', () => {
    vi.setSystemTime(new Date('2025-02-28T12:00:00Z'));

    render(
      <DueDateModule
        assignments={[
          {
            id: 'a1',
            title: 'Unreleased',
            dueDate: '2025-03-01T12:00:00Z',
            courseId: 'course-1',
            isPublished: false,
          },
        ]}
      />,
    );

    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
});
