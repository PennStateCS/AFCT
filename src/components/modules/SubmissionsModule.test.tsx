/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, it, expect, vi } from 'vitest';

import { SubmissionsModule } from './SubmissionsModule';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('SubmissionsModule', () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { React?: typeof React }).React = React;
  });

  it('renders empty state when no submissions need grading', () => {
    render(<SubmissionsModule pendingAssignments={[]} />);

    expect(screen.getByText('No submissions need grading.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Assignments needing grading' })).toBeNull();
  });

  it('renders pending assignments with links and pluralized counts', () => {
    render(
      <SubmissionsModule
        pendingAssignments={[
          {
            assignmentId: 'a1',
            assignmentTitle: 'Homework 1',
            courseId: 'course-1',
            dueDate: new Date('2026-03-01T00:00:00Z'),
            pendingCount: 1,
          },
          {
            assignmentId: 'a2',
            assignmentTitle: 'Project Draft',
            courseId: 'course-2',
            dueDate: new Date('2026-03-02T00:00:00Z'),
            pendingCount: 3,
          },
        ]}
      />,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);

    expect(links[0]).toHaveTextContent('Homework 1');
    expect(links[0]).toHaveAttribute('href', '/dashboard/courses/course-1/a1');
    expect(screen.getByText('1 submission need grading')).toBeInTheDocument();

    expect(links[1]).toHaveTextContent('Project Draft');
    expect(links[1]).toHaveAttribute('href', '/dashboard/courses/course-2/a2');
    expect(screen.getByText('3 submissions need grading')).toBeInTheDocument();
  });
});
