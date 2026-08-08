/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import DiscussionPanel, { type Comment } from './DiscussionPanel';

vi.mock('@/lib/date-format', () => ({
  formatDateTimeInTimeZone: () => 'a while ago',
}));
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));
// The panel reads the session to decide whose comments show a delete button; that is not
// what these tests are about.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'fac1' } } }),
}));

const groupComment: Comment = {
  id: 'c1',
  content: 'Good decomposition',
  createdAt: '2026-01-01T00:00:00.000Z',
  aboutGroupId: 'g1',
  aboutStudentId: null,
  author: { id: 'fac1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
};

const privateComment: Comment = {
  id: 'c2',
  content: 'Check your own contribution',
  createdAt: '2026-01-01T00:00:00.000Z',
  aboutGroupId: null,
  aboutStudentId: 's1',
  author: { id: 'fac1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
};

const baseProps = {
  courseIsArchived: false,
  comments: [] as Comment[],
  commentText: '',
  onCommentTextChange: vi.fn(),
  onSaveComment: vi.fn(),
  onDeleteComment: vi.fn(),
};

const groupAudience = (onTargetChange = vi.fn(), target: 'student' | 'group' = 'group') => ({
  group: { id: 'g1', name: 'Group 3' },
  studentName: 'Grace Hopper',
  target,
  onTargetChange,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DiscussionPanel audience', () => {
  // Staff scanning an old thread cannot otherwise tell a group note from a private one,
  // and that is the mistake with consequences for a student.
  it('badges a group comment and a private one differently', () => {
    render(
      <DiscussionPanel
        {...baseProps}
        comments={[groupComment, privateComment]}
        audience={groupAudience()}
        subjectName="Grace Hopper"
      />,
    );

    // Scoped to the thread: the composer's radio for a private comment carries the same
    // words, and matching that instead would pass with no badges rendered at all.
    const thread = within(screen.getByRole('list'));
    expect(thread.getByText('Visible to Group 3')).toBeInTheDocument();
    expect(thread.getByText('Only Grace Hopper')).toBeInTheDocument();
  });

  // On an individual assignment every comment is between staff and that one student, so a
  // badge on each would repeat the same fact on every row.
  it('shows no badges on an individual assignment', () => {
    render(<DiscussionPanel {...baseProps} comments={[privateComment]} audience={null} />);

    expect(screen.queryByText(/Only /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Visible to /)).not.toBeInTheDocument();
  });

  it('offers the choice of audience, defaulting to the group', () => {
    render(<DiscussionPanel {...baseProps} audience={groupAudience()} />);

    const group = screen.getByRole('radio', { name: 'Group 3' });
    expect(group).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Only Grace Hopper' })).not.toBeChecked();
  });

  it('reports a change of audience', async () => {
    const onTargetChange = vi.fn();
    render(<DiscussionPanel {...baseProps} audience={groupAudience(onTargetChange)} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Only Grace Hopper' }));

    expect(onTargetChange).toHaveBeenCalledWith('student');
  });

  it('offers no audience choice on an individual assignment', () => {
    render(<DiscussionPanel {...baseProps} audience={null} />);

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  // An archived course is read-only, so there is nothing to choose an audience for.
  it('hides the choice on an archived course', () => {
    render(<DiscussionPanel {...baseProps} courseIsArchived audience={groupAudience()} />);

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
