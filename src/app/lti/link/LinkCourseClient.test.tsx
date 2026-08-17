/** @vitest-environment jsdom */

/**
 * Choosing which AFCT course an LMS course opens.
 *
 * The decision is not reversible in any casual sense: the LMS course starts enrolling its
 * students into whatever is chosen and sending their grades there. So the two things that
 * matter are that the safe choice is the one on screen, and that nothing is chosen by default
 * when there is a decision to make.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import LinkCourseClient from './LinkCourseClient';

const mine = [
  { id: 'c1', name: 'Theory of Computation', code: 'CMPSC 464', semester: 'Fall 2026' },
];
const theirs = [
  { id: 'c2', name: 'Digital Systems', code: 'CMPEN 271', semester: 'Fall 2026' },
  { id: 'c3', name: 'Compilers', code: 'CMPSC 470', semester: 'Fall 2026' },
];

const picker = () => screen.getByRole('combobox');

describe('the course picker', () => {
  it('offers the courses you teach, and not the rest', async () => {
    render(<LinkCourseClient pendingId="p1" courses={mine} otherCourses={theirs} />);

    expect(
      within(picker()).getByRole('option', { name: /Theory of Computation/ }),
    ).toBeInTheDocument();
    expect(within(picker()).queryByRole('option', { name: /Compilers/ })).not.toBeInTheDocument();
  });

  it('reveals the rest only when asked, and says which are not yours', async () => {
    // An administrator may link any course, and that stays true. What changed is which choice
    // arrives already made.
    render(<LinkCourseClient pendingId="p1" courses={mine} otherCourses={theirs} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /Show all 3 courses/ }));

    const other = within(picker()).getByRole('option', { name: /Compilers/ });
    expect(other).toBeInTheDocument();
    expect(other.textContent).toMatch(/you do not teach this/);
  });

  it('says nothing about other courses to somebody who has none to show', async () => {
    render(<LinkCourseClient pendingId="p1" courses={mine} otherCourses={[]} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('starts with nothing chosen when there is a choice to make', async () => {
    render(<LinkCourseClient pendingId="p1" courses={[...mine, ...theirs]} />);

    // A course selected by arriving at the page is one nobody decided on.
    expect((picker() as HTMLSelectElement).value).toBe('');
  });

  it('preselects the only course there is, since there is nothing to decide', async () => {
    render(<LinkCourseClient pendingId="p1" courses={mine} />);

    expect((picker() as HTMLSelectElement).value).toBe('c1');
  });

  it('is one control however many courses there are', async () => {
    // The reason it is a select: an LMS draws this in a modal a few hundred pixels tall.
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `x${i}`,
      name: `Course ${i}`,
      code: 'X 1',
      semester: 'Fall 2026',
    }));
    render(<LinkCourseClient pendingId="p1" courses={many} />);

    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(within(picker()).getAllByRole('option').length).toBe(61);
  });
});
