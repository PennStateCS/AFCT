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
  closestGapMs: 7 * 60 * 1000,
  reusedAfterPass: false,
  matchesAnswerFile: false,
  submissions: pairOf('sarah', 'michael'),
  ...over,
});

const renderPanel = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AssignmentSimilarityPanel />
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

    expect(await screen.findByText('Very strong')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Exact JFLAP artifact' })).toBeInTheDocument();
    expect(screen.getByText('2 of 84 students submitted the same saved machine')).toBeInTheDocument();
    expect(screen.getByText('All 11 state positions are identical.')).toBeInTheDocument();
    expect(screen.getByText('11 states · 17 transitions')).toBeInTheDocument();
  });

  it('gives the same machine the middle presentation', async () => {
    getMock.mockResolvedValue([group({ studentCount: 3, identicalStudentCount: 2 })]);

    renderPanel();

    expect(await screen.findByText('Strong')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Same machine' })).toBeInTheDocument();
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

    expect(await screen.findByText('Possible')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Structurally similar' })).toBeInTheDocument();
    expect(screen.getByText('They differ by 2 transitions')).toBeInTheDocument();
  });

  it('keeps reuse after passing as secondary context beside the match type', async () => {
    getMock.mockResolvedValue([group({ reusedAfterPass: true })]);

    renderPanel();

    // Both are present, and the match type is the heading; the reuse is a badge next to it.
    expect(await screen.findByRole('heading', { name: 'Exact JFLAP artifact' })).toBeInTheDocument();
    expect(screen.getByText('Reused after passing')).toBeInTheDocument();
  });

  it('explains a match type in a popover reachable by keyboard', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([group()]);
    renderPanel();
    await screen.findByRole('heading', { name: 'Exact JFLAP artifact' });

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
    expect(screen.getByRole('heading', { name: 'Related submission group' })).toBeInTheDocument();
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
    expect(await screen.findAllByRole('button', { name: 'Compare' })).toHaveLength(2);
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

    const exactFilter = screen.getByRole('button', { name: /Exact JFLAP artifact/ });
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
      await screen.findByText('No matches worth reviewing. 1 common answer set aside.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /Show common answers/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await person.click(toggle);

    const card = await screen.findByRole('article');
    // Named by its kind, and by the problem it belongs to, since this list is not grouped.
    expect(
      within(card).getByRole('heading', { name: /Common answer.*Strings ending in 01/ }),
    ).toBeInTheDocument();
  });

  it('lists the students in order, with times, results and the gap from the first', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    const chronology = await screen.findByRole('list', { name: 'Submission order' });
    const rows = within(chronology).getAllByRole('listitem');

    expect(within(rows[0] as HTMLElement).getByText('sarah Student')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('First')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(/10:42 PM/)).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('+7 min')).toBeInTheDocument();
  });

  it('never calls anybody suspicious, and shows no percentage of similarity', async () => {
    getMock.mockResolvedValue([group({ reusedAfterPass: true, matchesAnswerFile: true })]);

    const { container } = renderPanel();
    await screen.findByRole('heading', { name: 'Exact JFLAP artifact' });

    const text = container.textContent?.toLowerCase() ?? '';
    for (const word of ['suspicious', 'plagiar', 'cheat', 'guilty', 'misconduct', 'likely copied']) {
      expect(text).not.toContain(word);
    }
    expect(text).not.toContain('hash');
  });

  it('opens the comparison from the card, earliest student first', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([group()]);
    renderPanel();
    await screen.findByRole('heading', { name: 'Exact JFLAP artifact' });

    await person.click(screen.getByRole('button', { name: /Compare submissions/ }));

    await waitFor(() => expect(screen.getByTestId('compare')).toBeInTheDocument());
    expect(screen.getByTestId('compare').textContent).toBe('sub-sarah vs sub-michael');
  });

  it('lets the reader move where common begins, and remembers it', async () => {
    const person = userEvent.setup();
    // 20 of 84 is under a quarter, so it starts as a finding.
    getMock.mockResolvedValue([group({ studentCount: 20, identicalStudentCount: 20 })]);

    renderPanel();
    await screen.findByRole('heading', { name: 'Exact JFLAP artifact' });

    await person.click(screen.getByRole('button', { name: /Adjust/ }));
    fireEvent.change(await screen.findByLabelText('Common threshold'), {
      target: { value: '0.2' },
    });

    // Past a fifth of the class it reads as the expected answer instead.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Exact JFLAP artifact' })).not.toBeInTheDocument(),
    );
    expect(window.localStorage.getItem('afct.similarityCommonShare')).toBe('0.2');
  });
});
