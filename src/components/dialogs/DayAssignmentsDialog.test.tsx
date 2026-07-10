/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import DayAssignmentsDialog from './DayAssignmentsDialog';

vi.mock('@/components/ui/dialog', () => import('@/test/mocks/ui').then((mod) => mod.dialogMock));
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

describe('DayAssignmentsDialog', () => {
  const assignments = [
    {
      id: 'a1',
      title: 'Homework 1',
      dueDate: '2025-01-01T12:00:00Z',
      courseId: 'c1',
      course: { code: 'CS101', name: 'Intro' },
    },
  ];

  it('renders assignments and handles navigation', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNavigate = vi.fn();

    render(
      <DayAssignmentsDialog
        open
        onOpenChange={vi.fn()}
        date={new Date('2025-01-01T00:00:00Z')}
        assignments={assignments}
        onClose={onClose}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByText('CS101 - Homework 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    await user.click(screen.getByRole('button', { name: 'Next day' }));
    expect(onNavigate).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('marks unpublished assignments with a Draft badge', () => {
    render(
      <DayAssignmentsDialog
        open
        onOpenChange={vi.fn()}
        date={new Date('2025-01-01T00:00:00Z')}
        assignments={[
          {
            id: 'p1',
            title: 'Published',
            dueDate: '2025-01-01T12:00:00Z',
            courseId: 'c1',
            isPublished: true,
            course: { id: 'c1', code: 'CS101', name: 'Intro' },
          },
          {
            id: 'd1',
            title: 'Draft One',
            dueDate: '2025-01-01T12:00:00Z',
            courseId: 'c1',
            isPublished: false,
            course: { id: 'c1', code: 'CS101', name: 'Intro' },
          },
        ]}
      />,
    );

    // Exactly one Draft badge — next to the unpublished assignment only.
    expect(screen.getAllByText('Draft')).toHaveLength(1);
    expect(screen.getByText('CS101 - Draft One')).toBeInTheDocument();
    expect(screen.getByText('CS101 - Published')).toBeInTheDocument();
  });

  it('shows an empty state when there are no assignments', () => {
    render(<DayAssignmentsDialog open onOpenChange={vi.fn()} date="2025-01-01" assignments={[]} />);

    expect(screen.getByText('No assignments for this day.')).toBeInTheDocument();
  });
});
