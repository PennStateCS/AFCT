/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import DiscussionPanel, { type Comment } from './DiscussionPanel';

vi.mock('@/lib/date-format', () => ({
  formatDateTimeInTimeZone: () => 'a while ago',
}));
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC', hour12: true }),
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'fac1' } } }),
}));

const comment: Comment = {
  id: 'c1',
  content: 'Nice work on the transitions',
  createdAt: '2026-01-01T00:00:00.000Z',
  aboutGroupId: null,
  aboutStudentId: null,
  author: { id: 'fac1', firstName: 'Ada', lastName: 'Lovelace', role: 'FACULTY' },
};

const props = {
  courseIsArchived: false,
  comments: [comment],
  commentText: '',
  onCommentTextChange: vi.fn(),
  onSaveComment: vi.fn(),
  onDeleteComment: vi.fn(),
};

/**
 * The avatar is the first thing to go when the panel is narrow.
 *
 * It costs 48px of every bubble's width and says nothing the line under the bubble does not,
 * which names the author in full. jsdom has no layout, so what these hold is the rule: the panel
 * is a container, the avatar answers to its width rather than the window's, and the author's
 * name is still there when the picture is not.
 */
describe('the avatar when the panel is narrow', () => {
  it('answers to the panel width, not the window', () => {
    const { container } = render(<DiscussionPanel {...props} />);

    expect(container.querySelector('section')?.className).toContain('@container/discussion');
  });

  it('is hidden until the panel has room for it', () => {
    render(<DiscussionPanel {...props} />);

    const avatarBox = screen.getByText('AL').closest('div[class*="flex-col"]');
    expect(avatarBox?.className).toContain('hidden');
    expect(avatarBox?.className).toContain('@[24rem]/discussion:flex');
  });

  it('still names the author when the picture is gone', () => {
    render(<DiscussionPanel {...props} />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  /*
   * The line under a bubble used to be one nowrap row clipped by overflow-hidden, so in a
   * narrow column the timestamp took the width and the name was truncated to nothing: a
   * comment with a time and no author. jsdom cannot measure that, so what this holds is the
   * rule that lets it wrap instead.
   */
  it('lets the author and the time take two lines rather than clipping one', () => {
    render(<DiscussionPanel {...props} />);

    const meta = screen.getByText('Ada Lovelace').parentElement;
    expect(meta?.className).toContain('flex-wrap');
    expect(meta?.className).not.toContain('overflow-hidden');
    // The time never shrinks; it moves.
    expect(screen.getByText('a while ago').className).toContain('shrink-0');
  });
});
