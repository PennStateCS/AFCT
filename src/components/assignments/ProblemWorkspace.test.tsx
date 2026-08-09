/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import ProblemWorkspace from './ProblemWorkspace';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'fac1' } } }),
}));
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));
// Partial mock: stubbing the whole module drops the other formatters this tree uses, and
// the failure surfaces as an unrelated "No export is defined" error.
vi.mock('@/lib/date-format', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  formatDateTimeInTimeZone: () => 'a while ago',
}));

const problem = {
  id: 'p1',
  title: 'Traffic Light',
  type: 'FA',
  maxPoints: 10,
  maxSubmissions: 3,
};

const baseProps = {
  problem,
  submissions: [],
  comments: [],
  commentText: '',
  onCommentTextChange: vi.fn(),
  onSaveComment: vi.fn(),
  onViewSubmission: vi.fn(),
  courseIsArchived: false,
  isPrivilegedUser: true,
};

const grantButton = <button type="button">Grant extra submissions</button>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProblemWorkspace submissions area', () => {
  // The table carries its own toolbar, headers and pager, so it is rendered in place rather
  // than inside a panel whose only content was the word "Submissions".
  it('names the table for assistive tech without a visible panel header', () => {
    render(
      <ProblemWorkspace
        {...baseProps}
        submissions={[
          {
            id: 's1',
            status: 'COMPLETED',
            correct: true,
            fileName: 'traffic.jff',
            originalFileName: 'traffic.jff',
            problemId: 'p1',
            submittedAt: '2026-01-01T00:00:00.000Z',
          } as never,
        ]}
        submissionsAction={grantButton}
      />,
    );

    expect(screen.getByRole('table', { name: /Submissions/i })).toBeInTheDocument();
  });

  // The action used to live in the panel header. With the panel gone it belongs with the
  // table's other controls.
  it('offers the grant action alongside the table controls', () => {
    render(
      <ProblemWorkspace
        {...baseProps}
        submissions={[
          {
            id: 's1',
            status: 'COMPLETED',
            correct: true,
            fileName: 'traffic.jff',
            originalFileName: 'traffic.jff',
            problemId: 'p1',
            submittedAt: '2026-01-01T00:00:00.000Z',
          } as never,
        ]}
        submissionsAction={grantButton}
      />,
    );

    expect(screen.getByRole('button', { name: 'Grant extra submissions' })).toBeInTheDocument();
  });

  /**
   * The case that is easy to lose: with no submissions the table is not rendered at all, so
   * an action living only in its toolbar would disappear exactly when a student has nothing
   * yet, which is a moment staff may well want to grant them another attempt.
   */
  it('keeps the grant action reachable when there are no submissions', () => {
    render(<ProblemWorkspace {...baseProps} submissionsAction={grantButton} />);

    expect(screen.getByText('No submissions yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant extra submissions' })).toBeInTheDocument();
  });

  it('renders the empty state without an action when none is given', () => {
    render(<ProblemWorkspace {...baseProps} />);

    expect(screen.getByText('No submissions yet.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Grant extra submissions' }),
    ).not.toBeInTheDocument();
  });
});
