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
  // than inside a panel whose only content was a heading.
  it('names the table for assistive tech', () => {
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

    expect(screen.getByRole('table', { name: /Problem attempts/i })).toBeInTheDocument();
  });

  // Granting sits on the problem's own title row, beside what it acts on, rather than in
  // the table toolbar where it competed with the table's controls.
  it('offers the grant action on the problem row', () => {
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
   * The case that is easy to lose: with no attempts the table is not rendered at all, so an
   * action living in its toolbar would disappear exactly when a student has nothing yet,
   * which is a moment staff may well want to grant them another attempt.
   */
  it('keeps the grant action reachable when there are no attempts', () => {
    render(<ProblemWorkspace {...baseProps} submissionsAction={grantButton} />);

    expect(screen.getByText('No attempts yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant extra submissions' })).toBeInTheDocument();
  });

  it('renders the empty state without an action when none is given', () => {
    render(<ProblemWorkspace {...baseProps} />);

    expect(screen.getByText('No attempts yet.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Grant extra submissions' }),
    ).not.toBeInTheDocument();
  });
});

/**
 * The verdict has to reach a screen reader.
 *
 * Result and Feedback are ordinary table cells, and a cell changing in place announces
 * nothing: a submission went from Pending to Incorrect and a counterexample appeared in a row
 * the reader had already passed, in silence. This is the student's own page, so it is the one
 * that matters most.
 */
describe('what a screen reader is told about the latest attempt', () => {
  const region = () => document.querySelector('[role="status"][aria-live="polite"]');

  const attempt = (over: Record<string, unknown> = {}) =>
    ({
      id: 's1',
      status: 'COMPLETED',
      correct: false,
      fileName: 'traffic.jff',
      originalFileName: 'traffic.jff',
      problemId: 'p1',
      submittedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    }) as never;

  it('is present and empty before anything has been submitted', () => {
    render(<ProblemWorkspace {...baseProps} submissions={[]} />);

    // Mounted up front: a region inserted with its first message is not reliably announced.
    expect(region()).toBeInTheDocument();
    expect(region()).toHaveTextContent('');
  });

  it('names the attempt, the verdict and the feedback', () => {
    render(
      <ProblemWorkspace
        {...baseProps}
        submissions={[attempt({ feedback: 'Rejected on input aab' })]}
      />,
    );

    expect(region()).toHaveTextContent('Attempt 1: Incorrect. Rejected on input aab');
  });

  /** The newest attempt is the one that holds the standing grade, so it is the one announced. */
  it('reports the newest attempt, not the first', () => {
    render(
      <ProblemWorkspace
        {...baseProps}
        submissions={[
          attempt({ id: 's1', submittedAt: '2026-01-01T00:00:00.000Z' }),
          attempt({ id: 's2', correct: true, submittedAt: '2026-01-02T00:00:00.000Z' }),
        ]}
      />,
    );

    expect(region()).toHaveTextContent('Attempt 2: Correct');
  });

  it('says a submission is still waiting rather than saying nothing', () => {
    render(
      <ProblemWorkspace
        {...baseProps}
        submissions={[attempt({ status: 'PENDING', correct: null })]}
      />,
    );

    expect(region()).toHaveTextContent('Attempt 1: Pending');
  });
});

/**
 * The discussion's wait, and its end.
 *
 * The loading notice carried `role="status"` but was mounted with its own text and then
 * replaced wholesale by the panel, so a live region that announces changes had nothing to
 * change: neither the wait nor its end was ever spoken.
 */
describe('loading the discussion', () => {
  const regions = () => Array.from(document.querySelectorAll('[role="status"]'));
  const textOf = () =>
    regions()
      .map((n) => n.textContent)
      .join(' | ');

  it('says it is loading', () => {
    render(<ProblemWorkspace {...baseProps} commentsLoading />);

    expect(textOf()).toContain('Loading the discussion.');
  });

  it('says so once it has arrived, rather than falling silent', () => {
    render(<ProblemWorkspace {...baseProps} commentsLoading={false} />);

    expect(textOf()).toContain('Discussion loaded.');
  });
});
