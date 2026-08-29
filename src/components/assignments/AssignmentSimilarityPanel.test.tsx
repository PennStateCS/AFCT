/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'c1', aid: 'a1' }) }));
vi.mock('@/lib/api/fetch-client', () => ({ apiClient: { get: getMock } }));
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC' }),
}));
// The real compare dialog pulls in cytoscape, which has nothing to do with what this panel
// decides. Its own contract is covered where it lives.
vi.mock('@/components/assignments/CompareSubmissionsDialog', () => ({
  CompareSubmissionsDialog: ({
    open,
    submissions,
  }: {
    open: boolean;
    submissions: { id: string }[] | null;
  }) => (open ? <div data-testid="compare">{submissions?.map((s) => s.id).join(' vs ')}</div> : null),
}));

import { AssignmentSimilarityPanel } from './AssignmentSimilarityPanel';

const student = (id: string, firstName: string) => ({
  id,
  firstName,
  lastName: 'Student',
  avatar: null,
  cropX: null,
  cropY: null,
  zoom: null,
});

const submission = (over: Record<string, unknown> = {}) => ({
  id: 'sub-1',
  submittedAt: '2026-08-14T22:42:00.000Z',
  correct: true,
  attempt: 1,
  assignmentId: 'a1',
  fileName: 'stored-1.jff',
  originalFileName: 'mine.jff',
  contentKey: 'aaaa1111',
  student: student('s1', 'Sarah'),
  studentGroup: null,
  ...over,
});

const pairOf = (a: string, b: string) => [
  submission({ id: `sub-${a}`, student: student(a, a), submittedAt: '2026-08-14T22:42:00.000Z' }),
  submission({
    id: `sub-${b}`,
    student: student(b, b),
    submittedAt: '2026-08-14T22:49:00.000Z',
  }),
];

const group = (over: Record<string, unknown> = {}) => ({
  matchId: 'abcd1234',
  kind: 'same-work' as const,
  evidence: [] as string[],
  stateCount: 11,
  transitionCount: 17,
  problem: { id: 'p1', title: 'Strings ending in 01', type: 'FA' },
  studentCount: 2,
  problemStudentCount: 84,
  identicalStudentCount: 2,
  byteIdenticalStudentCount: 1,
  closestGapMs: 7 * 60 * 1000,
  reusedAfterPass: false,
  matchesAnswerFile: false,
  submissions: pairOf('sarah', 'michael'),
  ...over,
});

const renderPanel = (props: { groupAssignment?: boolean } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AssignmentSimilarityPanel {...props} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue([]);
  window.localStorage.clear();
});

describe('AssignmentSimilarityPanel', () => {
  it('answers "is there anything to review" in one line', async () => {
    renderPanel();

    expect(await screen.findByText('No two students submitted related work.')).toBeInTheDocument();
  });

  it('summarises in match groups, not pairs, and calls out exact artifacts', async () => {
    getMock.mockResolvedValue([
      group({ matchId: 'ab', submissions: pairOf('a', 'b') }),
      group({ matchId: 'ac', submissions: pairOf('a', 'c') }),
    ]);

    renderPanel();

    expect(await screen.findByText('1 match group worth reviewing across 1 problem.')).toBeInTheDocument();
    expect(screen.getByText('1 contains an exact artifact match.')).toBeInTheDocument();
    expect(
      screen.getByText('2 similarity relationships are contained in these groups.'),
    ).toBeInTheDocument();
  });

  it('gives an exact artifact the strongest presentation', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    const card = await screen.findByRole('article');
    expect(within(card).getByText('Very strong')).toBeInTheDocument();
    expect(within(card).getByText('Exact JFLAP artifact')).toBeInTheDocument();
    expect(
      within(card).getByRole('heading', {
        name: '2 of 84 students submitted the same saved machine',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('All 11 state positions are identical.')).toBeInTheDocument();
    expect(screen.getByText('11 states · 17 transitions')).toBeInTheDocument();
  });

  it('calls a grammar a grammar, and claims nothing about its layout', async () => {
    getMock.mockResolvedValue([
      group({
        problem: { id: 'p2', title: 'Balanced parentheses', type: 'CFG' },
        stateCount: 0,
        transitionCount: 0,
      }),
    ]);

    renderPanel();

    const card = await screen.findByRole('article');
    expect(
      within(card).getByRole('heading', { name: '2 of 84 students submitted the same saved grammar' }),
    ).toBeInTheDocument();
    expect(
      within(card).getByText('The contents are identical once formatting is set aside.'),
    ).toBeInTheDocument();
    // Nothing has states, so nothing says it has none.
    expect(within(card).queryByText(/0 states/)).not.toBeInTheDocument();
  });

  it('gives the same machine the middle presentation', async () => {
    getMock.mockResolvedValue([group({ studentCount: 3, identicalStudentCount: 2 })]);

    renderPanel();

    const card = await screen.findByRole('article');
    expect(within(card).getByText('Strong')).toBeInTheDocument();
    expect(within(card).getByText('Same machine')).toBeInTheDocument();
    expect(screen.getByText('State names or positions differ.')).toBeInTheDocument();
  });

  it('gives a structural near-match the weakest presentation, with its evidence', async () => {
    getMock.mockResolvedValue([
      group({
        kind: 'near',
        identicalStudentCount: 1,
        evidence: ['9 of 13 pieces of local structure are the same', 'They differ by 2 transitions'],
      }),
    ]);

    renderPanel();

    const card = await screen.findByRole('article');
    expect(within(card).getByText('Possible')).toBeInTheDocument();
    expect(within(card).getByText('Structurally similar')).toBeInTheDocument();
    expect(screen.getByText('They differ by 2 transitions')).toBeInTheDocument();
  });

  it('keeps reuse after passing as secondary context beside the match type', async () => {
    getMock.mockResolvedValue([group({ reusedAfterPass: true })]);

    renderPanel();

    // Both are present, and reuse is a badge beside the match type rather than in place of it.
    const card = await screen.findByRole('article');
    expect(within(card).getByText('Exact JFLAP artifact')).toBeInTheDocument();
    expect(within(card).getByText('Reused after passing')).toBeInTheDocument();
  });

  it('explains a match type in a popover reachable by keyboard', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([group()]);
    renderPanel();
    await screen.findByRole('button', { name: 'Explain exact jflap artifact match' });

    await person.click(screen.getByRole('button', { name: 'Explain exact jflap artifact match' }));

    expect(await screen.findByRole('heading', { name: 'What this means' })).toBeInTheDocument();
    expect(screen.getByText(/same saved JFLAP artifact/)).toBeInTheDocument();
    // And the facts about this particular match.
    expect(screen.getByRole('heading', { name: 'This match' })).toBeInTheDocument();
    expect(screen.getByText('2 of 84 students are involved')).toBeInTheDocument();

    await person.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'What this means' })).not.toBeInTheDocument(),
    );
  });

  it('folds related pairs into one group instead of a card each', async () => {
    getMock.mockResolvedValue([
      group({ matchId: 'ab', submissions: pairOf('a', 'b') }),
      group({ matchId: 'ac', submissions: pairOf('a', 'c') }),
      group({ matchId: 'bc', submissions: pairOf('b', 'c') }),
    ]);

    renderPanel();

    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(1);
    // Neutral, because a group is held together by shared students rather than by everyone
    // sharing the same thing. What it is made of is spelled out underneath.
    expect(
      screen.getByRole('heading', { name: '3 of 84 students are connected by 3 similarity relationships' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 exact jflap artifact relationships/i)).toBeInTheDocument();
  });

  it('keeps a group\'s relationships behind one control', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([
      group({ matchId: 'ab', submissions: pairOf('a', 'b') }),
      group({ matchId: 'ac', submissions: pairOf('a', 'c') }),
    ]);

    renderPanel();
    const toggle = await screen.findByRole('button', { name: /Review the 2 relationships/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await person.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // One Compare per relationship, each naming who it is between, so a reader opening one
    // knows which two files they are about to see.
    // Each relationship says who it is between and what kind it is, and carries its own
    // Compare: the evidence belongs to those two files, not to the whole component.
    // Named twice on purpose: once in the row, once inside the button, so a reader moving
    // between buttons hears which relationship each Compare belongs to.
    expect(await screen.findAllByText('a Student and b Student')).toHaveLength(2);
    expect(screen.getAllByText('a Student and c Student')).toHaveLength(2);
    expect(screen.getAllByText(/Very strong · Exact JFLAP artifact/)).toHaveLength(2);
    // Two relationship compares, plus the secondary whole-group one.
    expect(screen.getAllByRole('button', { name: /Compare/ })).toHaveLength(3);
  });

  it('offers filters only for the kinds it can actually show', async () => {
    getMock.mockResolvedValue([
      group({ matchId: 'exact', submissions: pairOf('a', 'b') }),
      // Set aside: a common answer, and the instructor's own solution.
      group({ matchId: 'common', studentCount: 42, identicalStudentCount: 42, submissions: pairOf('c', 'd') }),
      group({ matchId: 'posted', matchesAnswerFile: true, submissions: pairOf('e', 'f') }),
    ]);

    renderPanel();
    await screen.findAllByRole('article');

    // A button that narrowed the page to a set-aside kind and then left the review list where
    // it was would be worse than no button; those two have their own section instead.
    expect(screen.queryByRole('button', { name: /Common answer/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Instructor reference solution/ }),
    ).not.toBeInTheDocument();
    // And All counts what All can show: one review card, not three groups.
    expect(screen.getByRole('button', { name: 'All1' })).toBeInTheDocument();
    expect(screen.getByText('Set aside (2)')).toBeInTheDocument();
  });

  it('filters to one kind of match, and says which is selected', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([
      group({ matchId: 'exact', submissions: pairOf('a', 'b') }),
      group({
        matchId: 'near',
        kind: 'near',
        identicalStudentCount: 1,
        submissions: pairOf('x', 'y'),
      }),
    ]);

    renderPanel();
    await screen.findAllByRole('article');

    const exactFilter = screen.getByRole('button', { name: /Exact artifact/ });
    await person.click(exactFilter);

    expect(exactFilter).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    expect(screen.queryByRole('heading', { name: 'Structurally similar' })).not.toBeInTheDocument();
  });

  it('collapses common answers, and renders none of them until asked', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([
      group({ matchId: 'common', studentCount: 42, identicalStudentCount: 42 }),
    ]);

    renderPanel();

    expect(
      await screen.findByText(
        'No matches worth reviewing. 1 group set aside as a common answer or the posted solution.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /Show set-aside groups/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await person.click(toggle);

    const card = await screen.findByRole('article');
    // Named by its kind, and by the problem it belongs to, since this list is not grouped.
    expect(
      within(card).getByRole('heading', { name: /Strings ending in 01/ }),
    ).toBeInTheDocument();
  });

  it('lists the students in order, with times, results and the gap from the first', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    const chronology = await screen.findByRole('list', { name: 'Matching attempts, earliest first' });
    const rows = within(chronology).getAllByRole('listitem');

    expect(within(rows[0] as HTMLElement).getByText('sarah Student')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('First')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(/10:42 PM/)).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('+7 min')).toBeInTheDocument();
  });

  it('never calls anybody suspicious, and shows no percentage of similarity', async () => {
    getMock.mockResolvedValue([group({ reusedAfterPass: true })]);

    const { container } = renderPanel();
    await screen.findByRole('article');

    const text = container.textContent?.toLowerCase() ?? '';
    for (const word of ['suspicious', 'plagiar', 'cheat', 'guilty', 'misconduct', 'likely copied']) {
      expect(text).not.toContain(word);
    }
    expect(text).not.toContain('hash');
  });

  it('shows every matching attempt, including two from the same student', async () => {
    // Sarah's second and fourth attempts both matched. Both have to be visible: which
    // attempt matched is the thing being reviewed, and a per-student list would show one.
    getMock.mockResolvedValue([
      group({
        matchId: 'attempts',
        submissions: [
          submission({
            id: 'sub-sarah-2',
            student: student('sarah', 'sarah'),
            attempt: 2,
            submittedAt: '2026-08-14T22:42:00.000Z',
          }),
          submission({
            id: 'sub-michael-1',
            student: student('michael', 'michael'),
            attempt: 1,
            submittedAt: '2026-08-14T22:49:00.000Z',
          }),
          submission({
            id: 'sub-sarah-4',
            student: student('sarah', 'sarah'),
            attempt: 4,
            submittedAt: '2026-08-14T23:36:00.000Z',
          }),
        ],
      }),
    ]);

    renderPanel();

    const attempts = await screen.findByRole('list', { name: 'Matching attempts, earliest first' });
    const rows = within(attempts).getAllByRole('listitem');

    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('sarah Student')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Attempt 2')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('michael Student')).toBeInTheDocument();
    // Chronological, and Sarah's later attempt is a row of its own rather than folded away.
    expect(within(rows[2] as HTMLElement).getByText('sarah Student')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Attempt 4')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('+54 min')).toBeInTheDocument();
  });

  it('reviews a group assignment as groups, naming who submitted each attempt', async () => {
    getMock.mockResolvedValue([
      group({
        matchId: 'teams',
        groupCount: 2,
        problemGroupCount: 9,
        submissions: [
          submission({
            id: 'sub-g4-1',
            student: student('alice', 'Alice'),
            studentGroup: { id: 'g4', name: 'Group 4' },
            attempt: 1,
            submittedAt: '2026-08-14T22:42:00.000Z',
          }),
          submission({
            id: 'sub-g7-1',
            student: student('david', 'David'),
            studentGroup: { id: 'g7', name: 'Group 7' },
            attempt: 1,
            submittedAt: '2026-08-14T22:49:00.000Z',
          }),
          // The same team again, submitted by a different member. Still one group.
          submission({
            id: 'sub-g4-2',
            student: student('bob', 'Bob'),
            studentGroup: { id: 'g4', name: 'Group 4' },
            attempt: 2,
            submittedAt: '2026-08-14T22:58:00.000Z',
          }),
        ],
      }),
    ]);

    renderPanel({ groupAssignment: true });

    // Two groups, not three students, and counted against the groups who submitted.
    expect(
      await screen.findByRole('heading', { name: /2 of 9 groups/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('9 groups submitted · 1 match group')).toBeInTheDocument();

    const attempts = screen.getByRole('list', { name: 'Matching attempts, earliest first' });
    const rows = within(attempts).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // The team leads; the member who pressed submit is kept as secondary detail, because any
    // member may submit and the work is not theirs alone.
    expect(within(rows[0] as HTMLElement).getByText('Group 4')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Submitted by Alice Student')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Group 4')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Submitted by Bob Student')).toBeInTheDocument();
  });

  it('judges a common answer by teams on a group assignment, not by their members', async () => {
    // Nine teams submitted; two of them share work, and between them they hold eight of the
    // twenty-eight students. That is 29% of the students and 22% of the teams, so counting
    // students would file this away as the expected answer and nobody would read it.
    getMock.mockResolvedValue([
      group({
        matchId: 'teams',
        studentCount: 8,
        problemStudentCount: 28,
        groupCount: 2,
        problemGroupCount: 9,
        submissions: [
          submission({
            id: 'sub-g4',
            student: student('alice', 'Alice'),
            studentGroup: { id: 'g4', name: 'Group 4' },
          }),
          submission({
            id: 'sub-g7',
            student: student('david', 'David'),
            studentGroup: { id: 'g7', name: 'Group 7' },
          }),
        ],
      }),
    ]);

    renderPanel({ groupAssignment: true });

    expect(await screen.findByRole('heading', { name: /2 of 9 groups/ })).toBeInTheDocument();
    // Worth reviewing, not set aside.
    expect(screen.getByText('1 match group worth reviewing across 1 problem.')).toBeInTheDocument();
    expect(screen.queryByText(/Set aside \(/)).not.toBeInTheDocument();
  });

  it('falls back to counting students when a group assignment has no groups on the work', async () => {
    // Older rows carry no group. Better a true sentence about students than an invented
    // denominator about teams.
    getMock.mockResolvedValue([group({ matchId: 'legacy', submissions: pairOf('a', 'b') })]);

    renderPanel({ groupAssignment: true });

    expect(await screen.findByRole('heading', { name: /2 of 84 students/ })).toBeInTheDocument();
    expect(screen.getByText('84 students submitted · 1 match group')).toBeInTheDocument();
  });

  it('opens the comparison from the card, earliest student first', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([group()]);
    renderPanel();
    await screen.findByRole('article');

    await person.click(screen.getByRole('button', { name: /Compare submissions/ }));

    await waitFor(() => expect(screen.getByTestId('compare')).toBeInTheDocument());
    expect(screen.getByTestId('compare').textContent).toBe('sub-sarah vs sub-michael');
  });

  it('lets the reader move where common begins, and remembers it', async () => {
    const person = userEvent.setup();
    // 20 of 84 is under a quarter, so it starts as a finding.
    getMock.mockResolvedValue([group({ studentCount: 20, identicalStudentCount: 20 })]);

    renderPanel();
    await screen.findByRole('article');

    await person.click(screen.getByRole('button', { name: /Adjust/ }));
    fireEvent.change(await screen.findByLabelText('Common-answer threshold'), {
      target: { value: '0.2' },
    });

    // Past a fifth of the class it reads as the expected answer instead.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Exact JFLAP artifact' })).not.toBeInTheDocument(),
    );
    expect(window.localStorage.getItem('afct.similarityCommonShare')).toBe('0.2');
  });
});
