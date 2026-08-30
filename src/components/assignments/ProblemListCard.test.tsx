/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProblemListCard } from './ProblemListCard';

/**
 * The two badges on a problem row.
 *
 * They used to read as "8/10, 2/3" with the meaning carried only by a `title`, which is not a
 * reliable description on a non-interactive span. This is the web app's only view of the
 * attempt limit, so a student had no way to tell the grade from the attempts left.
 */
const problem = {
  id: 'p1',
  title: 'Traffic Light',
  grade: 8,
  maxGrade: 10,
  submissionsCount: 2,
  maxSubmissions: 3,
};

const show = (over: Record<string, unknown> = {}) =>
  render(
    <ProblemListCard
      problems={[{ ...problem, ...over }] as never}
      selectedProblemId="p1"
      onSelect={vi.fn()}
      showSubmissionUsage
    />,
  );

describe('ProblemListCard badges', () => {
  it('says which fraction is the grade', () => {
    const { container } = show();

    // "Grade 8/10" rather than a bare "8/10" sitting next to a bare "2/3".
    expect(container.textContent).toContain('Grade');
    expect(container.textContent).toContain('8/10');
  });

  it('spells out the attempts rather than leaving a bare fraction', () => {
    const { container } = show();

    expect(container.textContent).toContain('2 of 3 attempts used');
  });

  /** Screen readers disagree about "∞": some say "infinity", some say nothing. */
  it('says unlimited in words when there is no cap', () => {
    const { container } = show({ maxSubmissions: -1 });

    expect(container.textContent).toContain('unlimited allowed');
  });
});

describe('a problem nobody handed in', () => {
  it('says so beside the zero, rather than showing a bare zero', () => {
    // The same number as a zero somebody earned by getting it wrong, and only one of them is
    // something the student can still do anything about.
    render(
      <ProblemListCard
        problems={[
          { id: 'p1', title: 'Problem 1', grade: 0, maxGrade: 10, missing: true },
          { id: 'p2', title: 'Problem 2', grade: 0, maxGrade: 10 },
        ]}
        selectedProblemId="p1"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Not submitted')).toHaveLength(1);
  });
});
