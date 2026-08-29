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
  }) =>
    open ? <div data-testid="compare">{submissions?.map((s) => s.id).join(' vs ')}</div> : null,
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
  // Which set of byte-identical files this submission is in, as the API labels them. Every
  // fixture is one set unless a case says otherwise.
  byteKey: 'b1',
  student: student('s1', 'Sarah'),
  studentGroup: null,
  ...over,
});

const pairOf = (
  a: string,
  b: string,
  // Which set of byte-identical files each of the two is in. The same set by default, which
  // is what a shared file looks like; a case about files that only normalise alike passes
  // two different ones.
  [aBytes, bBytes]: [string | null, string | null] = ['b1', 'b1'],
) => [
  submission({
    id: `sub-${a}`,
    student: student(a, a),
    submittedAt: '2026-08-14T22:42:00.000Z',
    byteKey: aBytes,
  }),
  submission({
    id: `sub-${b}`,
    student: student(b, b),
    submittedAt: '2026-08-14T22:49:00.000Z',
    byteKey: bBytes,
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

/**
 * The page opens with every problem closed, so a test that reads a card opens it first.
 * Named by the counts in the header ("… · 2 match groups"), which is what the trigger says.
 */
/** A fresh user-event session. Each test that clicks sets one up. */
const person = () => userEvent.setup();

const openProblems = async () => {
  await waitFor(() =>
    expect(screen.queryAllByRole('button', { name: /match group/i }).length).toBeGreaterThan(0),
  );
  for (const header of screen.queryAllByRole('button', { name: /match group/i })) {
    fireEvent.click(header);
  }
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
      group({ matchId: 'ab', submissions: pairOf('a', 'b', ['b1', 'b2']) }),
      group({ matchId: 'ac', submissions: pairOf('a', 'c', ['b1', 'b3']) }),
    ]);

    renderPanel();

    expect(
      await screen.findByText('1 match group worth reviewing across 1 problem.'),
    ).toBeInTheDocument();
    expect(screen.getByText('1 contains an exact artifact match.')).toBeInTheDocument();
    expect(
      screen.getByText('2 similarity relationships are contained in these groups.'),
    ).toBeInTheDocument();
  });

  it('says byte-for-byte identical when that is true of the whole relationship', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    await openProblems();

    const card = await screen.findByRole('article');
    expect(within(card).getByText('Very strong')).toBeInTheDocument();
    // The strongest thing that is true of these two files, and only it: "exact artifact" is
    // the same finding stated more weakly, and both would read as two different claims.
    expect(within(card).getByText('Byte-for-byte identical')).toBeInTheDocument();
    expect(within(card).queryByText('Exact JFLAP artifact')).toBeNull();
    expect(
      within(card).getByRole('heading', {
        name: '2 of 84 students submitted the same saved machine',
      }),
    ).toBeInTheDocument();
    // Byte-identical files are identical before anything is normalised and their drawings
    // cannot differ, so the card says the strongest fact and stops.
    expect(within(card).getByText('Files are byte-for-byte identical.')).toBeInTheDocument();
    expect(within(card).queryByText(/state positions are identical/)).not.toBeInTheDocument();
    expect(
      within(card).queryByText('The structure and the saved drawing coordinates are identical.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('11 states · 17 transitions')).toBeInTheDocument();
  });

  it('stays an exact artifact when the files only agree once formatting is ignored', async () => {
    getMock.mockResolvedValue([group({ submissions: pairOf('ada', 'grace', ['b1', 'b2']) })]);

    renderPanel();

    await openProblems();

    const card = await screen.findByRole('article');
    expect(within(card).getByText('Exact JFLAP artifact')).toBeInTheDocument();
    expect(within(card).queryByText('Byte-for-byte identical')).toBeNull();
    // And no claim about the raw files, because there is none to make.
    expect(within(card).queryByText(/byte-for-byte identical/)).toBeNull();
    expect(
      within(card).getByText('The structure and the saved drawing coordinates are identical.'),
    ).toBeInTheDocument();
  });

  it('still describes the drawing when the raw files were never hashed', async () => {
    getMock.mockResolvedValue([
      group({
        submissions: [
          submission({ id: 'sub-a', student: student('a', 'Ada'), byteKey: null }),
          submission({ id: 'sub-b', student: student('b', 'Grace'), byteKey: null }),
        ],
      }),
    ]);

    renderPanel();
    await openProblems();

    const card = await screen.findByRole('article');
    expect(within(card).queryByText(/byte-for-byte/)).not.toBeInTheDocument();
    expect(
      within(card).getByText('The structure and the saved drawing coordinates are identical.'),
    ).toBeInTheDocument();
    expect(within(card).getByText('All 11 state positions are identical.')).toBeInTheDocument();
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

    await openProblems();

    const card = await screen.findByRole('article');
    expect(
      within(card).getByRole('heading', {
        name: '2 of 84 students submitted the same saved grammar',
      }),
    ).toBeInTheDocument();
    // Both files are the same bytes, so the card says that and not the weaker version of it.
    expect(within(card).getByText('Files are byte-for-byte identical.')).toBeInTheDocument();
    expect(
      within(card).queryByText('The contents are identical once formatting is set aside.'),
    ).not.toBeInTheDocument();
    // Nothing has states, so nothing says it has none.
    expect(within(card).queryByText(/0 states/)).not.toBeInTheDocument();
  });

  it('gives the same machine the middle presentation', async () => {
    getMock.mockResolvedValue([group({ studentCount: 3, identicalStudentCount: 2 })]);

    renderPanel();

    await openProblems();

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
        evidence: [
          '9 of 13 pieces of local structure are the same',
          'They differ by 2 transitions',
        ],
      }),
    ]);

    renderPanel();

    await openProblems();

    const card = await screen.findByRole('article');
    expect(within(card).getByText('Possible')).toBeInTheDocument();
    expect(within(card).getByText('Structurally similar')).toBeInTheDocument();
    expect(screen.getByText('They differ by 2 transitions')).toBeInTheDocument();
  });

  it('keeps reuse after passing as secondary context beside the match type', async () => {
    getMock.mockResolvedValue([group({ reusedAfterPass: true })]);

    renderPanel();

    await openProblems();

    // Both are present, and reuse is a badge beside the match type rather than in place of it.
    const card = await screen.findByRole('article');
    expect(within(card).getByText('Byte-for-byte identical')).toBeInTheDocument();
    expect(within(card).getByText('Reused after passing')).toBeInTheDocument();
  });

  it('explains a match type in a popover reachable by keyboard', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([group({ submissions: pairOf('ada', 'grace', ['b1', 'b2']) })]);
    renderPanel();
    await openProblems();
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

    await openProblems();

    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(1);
    // Neutral, because a group is held together by shared students rather than by everyone
    // sharing the same thing. What it is made of is spelled out underneath.
    expect(
      screen.getByRole('heading', {
        name: '3 of 84 students are connected by 3 similarity relationships',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 byte-for-byte identical relationships/i)).toBeInTheDocument();
  });

  it("keeps a group's relationships behind one control", async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([
      group({ matchId: 'ab', submissions: pairOf('a', 'b') }),
      group({ matchId: 'ac', submissions: pairOf('a', 'c') }),
    ]);

    renderPanel();

    await openProblems();
    const toggle = await screen.findByRole('button', { name: /Review the 2 relationships/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await person.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Each relationship names its own participants, one per line with their own attempt, and
    // carries its own Compare: the evidence belongs to those files, not to everybody the
    // component happens to connect.
    const list = await screen.findByRole('list', { name: 'Relationships in this group' });
    const rows = within(list).getAllByRole('listitem', { hidden: false });
    const ab = rows.find((row) => row.textContent?.includes('b Student'));
    expect(within(ab as HTMLElement).getByText('a Student')).toBeInTheDocument();
    expect(within(ab as HTMLElement).getAllByText('Attempt 1').length).toBeGreaterThan(0);
    // Each relationship carries its own evidence badge rather than borrowing the card's.
    expect(screen.getAllByText(/Byte-for-byte identical/).length).toBeGreaterThanOrEqual(2);
    // Two relationship compares, plus the secondary whole-group one, each named for who it
    // is between so a reader moving between buttons knows which files they will see.
    const compares = screen.getAllByRole('button', { name: /Compare/ });
    expect(compares).toHaveLength(3);
    expect(
      compares.some((button) => /a Student and b Student/.test(button.textContent ?? '')),
    ).toBe(true);
  });

  it('opens as a list of problems, with each one closed until it is asked for', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([
      group({ matchId: 'ab', submissions: pairOf('a', 'b') }),
      group({
        matchId: 'other-problem',
        problem: { id: 'p2', title: 'a^n b^n', type: 'CFG' },
        submissions: pairOf('c', 'd'),
      }),
    ]);

    renderPanel();

    // Both problems are named, and nothing inside either is drawn: a reader arriving asks
    // which problem needs them, not which student.
    const first = await screen.findByRole('button', { name: /Strings ending in 01/ });
    const second = screen.getByRole('button', { name: /a\^n b\^n/ });
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('article')).toHaveLength(0);

    await person.click(first);

    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findAllByRole('article')).toHaveLength(1);
    // Opening one problem leaves the other where it was.
    expect(second).toHaveAttribute('aria-expanded', 'false');
  });

  it('says which students share which evidence, not just how many', async () => {
    // Stephen is in both relationships, with a different attempt in each. The card must not
    // leave a reader working out whose attempt 2 it was.
    const attempt = (id: string, name: string, n: number, byteKey: string | null, at: string) =>
      submission({
        id: `sub-${id}-${n}`,
        student: student(id, name),
        attempt: n,
        byteKey,
        submittedAt: at,
      });

    getMock.mockResolvedValue([
      group({
        matchId: 'st',
        studentCount: 2,
        submissions: [
          attempt('stephen', 'Stephen', 1, 'b1', '2026-08-17T10:47:00.000Z'),
          attempt('thor', 'Thor', 1, 'b1', '2026-08-17T07:26:00.000Z'),
        ],
      }),
      group({
        matchId: 'sms',
        studentCount: 3,
        submissions: [
          attempt('stephen', 'Stephen', 2, 'b2', '2026-08-17T13:10:00.000Z'),
          attempt('miles', 'Miles', 1, 'b2', '2026-08-14T09:22:00.000Z'),
          attempt('sam', 'Sam', 1, 'b2', '2026-08-10T07:33:00.000Z'),
        ],
      }),
    ]);

    renderPanel();
    await openProblems();

    // The cluster keeps only what is true of all four, and says nothing vague about bytes.
    expect(
      await screen.findByRole('heading', { name: /4 of 84 students are connected by 2/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/of them submitted byte-for-byte identical files/)).toBeNull();

    await person().click(screen.getByRole('button', { name: /Review the 2 relationships/ }));

    const rows = within(
      await screen.findByRole('list', { name: 'Relationships in this group' }),
    ).getAllByRole('listitem');

    const withThor = rows.find((row) => row.textContent?.includes('Thor Student'))!;
    expect(within(withThor).getByText('Stephen Student')).toBeInTheDocument();
    // Stephen's FIRST attempt is the one in this relationship.
    expect(within(withThor).getAllByText('Attempt 1')).toHaveLength(2);
    expect(within(withThor).getByText('Files are byte-for-byte identical.')).toBeInTheDocument();

    const withSam = rows.find((row) => row.textContent?.includes('Sam Student'))!;
    expect(within(withSam).getByText('Attempt 2')).toBeInTheDocument();
    expect(
      within(withSam).getByText('All 3 submitted files are byte-for-byte identical.'),
    ).toBeInTheDocument();
  });

  it('keeps the badge at what covers everyone when only some files agree to the byte', async () => {
    // Ada and Grace sent the same file; Hedy sent the same artifact saved differently. The
    // badge speaks for all three, so it stays at the exact artifact and the stronger fact
    // is said about the two it is true of.
    getMock.mockResolvedValue([
      group({
        matchId: 'subset',
        studentCount: 3,
        identicalStudentCount: 3,
        submissions: [
          submission({ id: 'sub-ada', student: student('ada', 'Ada'), byteKey: 'b1' }),
          submission({ id: 'sub-grace', student: student('grace', 'Grace'), byteKey: 'b1' }),
          submission({ id: 'sub-hedy', student: student('hedy', 'Hedy'), byteKey: 'b2' }),
        ],
      }),
    ]);

    renderPanel();
    await openProblems();

    const card = await screen.findByRole('article');
    expect(within(card).getByText('Exact JFLAP artifact')).toBeInTheDocument();
    expect(within(card).queryByText('Byte-for-byte identical')).toBeNull();
    expect(
      within(card).getByText(
        'Ada Student and Grace Student submitted byte-for-byte identical files.',
      ),
    ).toBeInTheDocument();
  });

  it('stays neutral about a group of two different kinds of relationship', async () => {
    getMock.mockResolvedValue([
      group({ matchId: 'ab', submissions: pairOf('alice', 'bob') }),
      group({
        matchId: 'bc',
        kind: 'near',
        identicalStudentCount: 1,
        evidence: ['They differ by 1 transition'],
        submissions: pairOf('bob', 'carol'),
      }),
    ]);

    renderPanel();
    await openProblems();

    // The card says what it is, not what its strongest part is.
    expect(await screen.findByText('2 similarity relationships')).toBeInTheDocument();
    const card = screen.getByRole('article');
    expect(within(card).queryByText(/VERY STRONG/i)).toBeNull();

    await person().click(screen.getByRole('button', { name: /Review the 2 relationships/ }));

    // The badges belong to the relationships, one each.
    const rows = within(
      await screen.findByRole('list', { name: 'Relationships in this group' }),
    ).getAllByRole('listitem');
    const exact = rows.find((row) => row.textContent?.includes('Byte-for-byte identical'))!;
    const structural = rows.find((row) => row.textContent?.includes('Structurally similar'))!;
    expect(within(exact).getByText(/Very strong/i)).toBeInTheDocument();
    expect(within(structural).getByText(/Possible/i)).toBeInTheDocument();
    expect(within(structural).getByText('They differ by 1 transition')).toBeInTheDocument();
  });

  it('names the teams in a relationship, with the member who sent each attempt', async () => {
    getMock.mockResolvedValue([
      group({
        matchId: 'teams-a',
        groupCount: 2,
        problemGroupCount: 9,
        submissions: [
          submission({
            id: 'sub-g4',
            student: student('alice', 'Alice'),
            studentGroup: { id: 'g4', name: 'Group 4' },
            attempt: 2,
          }),
          submission({
            id: 'sub-g7',
            student: student('david', 'David'),
            studentGroup: { id: 'g7', name: 'Group 7' },
            attempt: 1,
          }),
        ],
      }),
      group({
        matchId: 'teams-b',
        groupCount: 2,
        problemGroupCount: 9,
        submissions: [
          submission({
            id: 'sub-g7-2',
            student: student('david', 'David'),
            studentGroup: { id: 'g7', name: 'Group 7' },
            attempt: 2,
          }),
          submission({
            id: 'sub-g9',
            student: student('erin', 'Erin'),
            studentGroup: { id: 'g9', name: 'Group 9' },
            attempt: 1,
          }),
        ],
      }),
    ]);

    renderPanel({ groupAssignment: true });
    await openProblems();

    await person().click(await screen.findByRole('button', { name: /Review the 2 relationships/ }));

    const rows = within(
      await screen.findByRole('list', { name: 'Relationships in this group' }),
    ).getAllByRole('listitem');
    const first = rows.find((row) => row.textContent?.includes('Group 4'))!;

    // The team is the participant; who pressed submit is detail hanging off the attempt.
    expect(within(first).getByText('Group 4')).toBeInTheDocument();
    expect(within(first).getByText(/submitted by Alice Student/)).toBeInTheDocument();
    expect(within(first).getByText('Attempt 2')).toBeInTheDocument();
    // The byte sentence names teams, never the members who happened to send the files.
    expect(within(first).getByText('Files are byte-for-byte identical.')).toBeInTheDocument();
  });

  it('offers filters only for the kinds it can actually show', async () => {
    getMock.mockResolvedValue([
      group({ matchId: 'exact', submissions: pairOf('a', 'b') }),
      // Set aside: a common answer, and the instructor's own solution.
      group({
        matchId: 'common',
        studentCount: 42,
        identicalStudentCount: 42,
        submissions: pairOf('c', 'd'),
      }),
      group({ matchId: 'posted', matchesAnswerFile: true, submissions: pairOf('e', 'f') }),
    ]);

    renderPanel();

    await openProblems();
    await screen.findAllByRole('article');

    // A button that narrowed the page to a set-aside kind and then left the review list where
    // it was would be worse than no button; those two have their own card instead. Scoped to
    // the filter row, because that card's own header says "Common answers" too.
    const filters = within(screen.getByRole('group', { name: 'Filter matches' }));
    expect(filters.queryByRole('button', { name: /Common answer/ })).not.toBeInTheDocument();
    expect(
      filters.queryByRole('button', { name: /Instructor reference solution/ }),
    ).not.toBeInTheDocument();
    // And All counts what All can show: one review card, not three groups.
    expect(screen.getByRole('button', { name: 'All1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set aside \(2\)/ })).toBeInTheDocument();
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

    await openProblems();
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

    // Its own card, closed like a problem's, opened from the header.
    const toggle = screen.getByRole('button', { name: /Set aside \(1\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await person.click(toggle);

    const card = await screen.findByRole('article');
    // Named by its kind, and by the problem it belongs to, since this list is not grouped.
    expect(within(card).getByRole('heading', { name: /Strings ending in 01/ })).toBeInTheDocument();
  });

  it('lists the students in order, with times, results and the gap from the first', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    await openProblems();

    const chronology = await screen.findByRole('list', {
      name: 'Matching attempts, earliest first',
    });
    const rows = within(chronology).getAllByRole('listitem');

    expect(within(rows[0] as HTMLElement).getByText('sarah Student')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('First')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(/10:42 PM/)).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('+7 min')).toBeInTheDocument();
  });

  it('never calls anybody suspicious, and shows no percentage of similarity', async () => {
    getMock.mockResolvedValue([group({ reusedAfterPass: true })]);

    const { container } = renderPanel();

    await openProblems();
    await screen.findByRole('article');

    const text = container.textContent?.toLowerCase() ?? '';
    for (const word of [
      'suspicious',
      'plagiar',
      'cheat',
      'guilty',
      'misconduct',
      'likely copied',
    ]) {
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

    await openProblems();

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

    await openProblems();

    // Two groups, not three students, and counted against the groups who submitted.
    expect(await screen.findByRole('heading', { name: /2 of 9 groups/ })).toBeInTheDocument();
    expect(screen.getByText('9 groups submitted · 1 match group')).toBeInTheDocument();

    const attempts = screen.getByRole('list', { name: 'Matching attempts, earliest first' });
    const rows = within(attempts).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // The team leads; the member who pressed submit is kept as secondary detail, because any
    // member may submit and the work is not theirs alone.
    expect(within(rows[0] as HTMLElement).getByText('Group 4')).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByText('Submitted by Alice Student'),
    ).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Group 4')).toBeInTheDocument();
    expect(
      within(rows[2] as HTMLElement).getByText('Submitted by Bob Student'),
    ).toBeInTheDocument();
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

    await openProblems();

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

    await openProblems();

    expect(await screen.findByRole('heading', { name: /2 of 84 students/ })).toBeInTheDocument();
    expect(screen.getByText('84 students submitted · 1 match group')).toBeInTheDocument();
  });

  it('opens the comparison from the card, earliest student first', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([group()]);
    renderPanel();
    await openProblems();
    await screen.findByRole('article');

    await person.click(screen.getByRole('button', { name: /Compare submissions/ }));

    await waitFor(() => expect(screen.getByTestId('compare')).toBeInTheDocument());
    expect(screen.getByTestId('compare').textContent).toBe('sub-sarah vs sub-michael');
  });

  it('lets the reader move where common begins, and remembers it', async () => {
    // 20 of 84 is under a quarter, so it starts as a finding.
    getMock.mockResolvedValue([group({ studentCount: 20, identicalStudentCount: 20 })]);

    renderPanel();

    await openProblems();
    await screen.findByRole('article');

    // The dial itself, in the summary card, without opening anything first.
    const slider = screen.getByLabelText('Common-answer threshold');
    expect(slider).toHaveAttribute('min', '0.05');
    expect(slider).toHaveAttribute('max', '1');
    expect(slider).toHaveAttribute('step', '0.05');

    fireEvent.change(slider, { target: { value: '0.2' } });

    // Past a fifth of the class it reads as the expected answer instead.
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Exact JFLAP artifact' }),
      ).not.toBeInTheDocument(),
    );
    expect(window.localStorage.getItem('afct.similarityCommonShare')).toBe('0.2');
    expect(screen.getByLabelText('Common-answer threshold')).toHaveValue('0.2');
    expect(screen.getAllByText('20%').length).toBeGreaterThan(0);
  });

  it('keeps the same setting behind Adjust, for a card too narrow to hold the dial', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([group({ studentCount: 20, identicalStudentCount: 20 })]);

    renderPanel();
    await openProblems();
    await screen.findByRole('article');

    await person.click(screen.getByRole('button', { name: /Adjust/ }));

    // Two presentations of one setting, never two settings: whichever the card is showing,
    // moving it moves the other and the page with it.
    const sliders = await screen.findAllByLabelText('Common-answer threshold');
    expect(sliders).toHaveLength(2);
    expect(sliders.every((slider) => (slider as HTMLInputElement).value === '0.25')).toBe(true);

    fireEvent.change(sliders[1] as HTMLInputElement, { target: { value: '0.2' } });

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Exact JFLAP artifact' }),
      ).not.toBeInTheDocument(),
    );
    const moved = screen.getAllByLabelText('Common-answer threshold');
    expect(moved.every((slider) => (slider as HTMLInputElement).value === '0.2')).toBe(true);
    expect(window.localStorage.getItem('afct.similarityCommonShare')).toBe('0.2');
  });

  it("explains the threshold in the reader's own unit", async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([group()]);

    const individual = renderPanel();
    await person.click(await screen.findByRole('button', { name: /Adjust/ }));
    expect(await screen.findByText(/share of a problem's students/)).toBeInTheDocument();
    individual.unmount();

    renderPanel({ groupAssignment: true });
    await person.click(await screen.findByRole('button', { name: /Adjust/ }));
    expect(await screen.findByText(/share of a problem's groups/)).toBeInTheDocument();
  });
});
