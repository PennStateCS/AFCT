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
  student: student('s1', 'Alex'),
  studentGroup: null,
  ...over,
});

const group = (over: Record<string, unknown> = {}) => ({
  matchId: 'abcd1234',
  problem: { id: 'p1', title: 'Strings ending in 01', type: 'FA' },
  studentCount: 2,
  problemStudentCount: 38,
  identicalStudentCount: 2,
  closestGapMs: 11 * 60 * 1000,
  reusedAfterPass: false,
  matchesAnswerFile: false,
  submissions: [
    submission({
      id: 'sub-1',
      submittedAt: '2026-08-14T22:53:00.000Z',
      student: student('s2', 'Jamie'),
      attempt: 1,
    }),
    submission({
      id: 'sub-2',
      submittedAt: '2026-08-14T22:42:00.000Z',
      student: student('s1', 'Alex'),
      attempt: 3,
    }),
  ],
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

    expect(await screen.findByText('No two students submitted matching work.')).toBeInTheDocument();
  });

  it('counts what is worth reviewing, and says when work was reused after a pass', async () => {
    getMock.mockResolvedValue([group({ reusedAfterPass: true })]);

    renderPanel();

    expect(await screen.findByText('1 match worth reviewing across 1 problem.')).toBeInTheDocument();
    expect(
      screen.getByText('1 includes work reused after another student received a correct result.'),
    ).toBeInTheDocument();
  });

  it('heads each problem with its title and how many submitted it', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    expect(await screen.findByRole('heading', { name: 'Strings ending in 01' })).toBeInTheDocument();
    expect(screen.getByText('38 students submitted · 1 match')).toBeInTheDocument();
  });

  it('leads a card with what kind of match it is, then what that means', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    expect(await screen.findByRole('heading', { name: 'Identical file' })).toBeInTheDocument();
    expect(screen.getByText('2 of 38 students submitted the identical file')).toBeInTheDocument();
    expect(screen.getByText('Closest submissions were 11 minutes apart.')).toBeInTheDocument();
  });

  it('describes a shape-only match in the words of the problem type', async () => {
    getMock.mockResolvedValue([group({ identicalStudentCount: 1 })]);

    renderPanel();

    expect(
      await screen.findByRole('heading', { name: 'Same work, drawn differently' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 of 38 students submitted the same machine')).toBeInTheDocument();
    expect(screen.getByText('State names or positions differ.')).toBeInTheDocument();
  });

  it('says how many of a mixed match sent the very same file', async () => {
    getMock.mockResolvedValue([
      group({
        studentCount: 3,
        identicalStudentCount: 2,
        problem: { id: 'p1', title: 'P', type: 'CFG' },
      }),
    ]);

    renderPanel();

    expect(await screen.findByRole('heading', { name: 'Same work' })).toBeInTheDocument();
    // A grammar is not a machine.
    expect(screen.getByText('3 of 38 students submitted the same grammar')).toBeInTheDocument();
    expect(screen.getByText('2 of them submitted the identical file.')).toBeInTheDocument();
  });

  it('lists the students in order, with times, results and the gap from the first', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    const rows = await screen.findAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByText('Alex Student')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('First')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(/10:42 PM/)).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('Submission 3 · Correct')).toBeInTheDocument();

    expect(within(rows[1] as HTMLElement).getByText('Jamie Student')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('+11 min')).toBeInTheDocument();
  });

  it('marks an ungraded attempt as such rather than guessing', async () => {
    getMock.mockResolvedValue([
      group({
        submissions: [
          submission({ id: 'sub-1', correct: null, student: student('s1', 'Alex') }),
          submission({
            id: 'sub-2',
            correct: false,
            submittedAt: '2026-08-14T23:00:00.000Z',
            student: student('s2', 'Jamie'),
          }),
        ],
      }),
    ]);

    renderPanel();

    expect(await screen.findByText(/Not graded/)).toBeInTheDocument();
    expect(screen.getByText(/Incorrect/)).toBeInTheDocument();
  });

  it('notes the reference solution quietly, without a badge', async () => {
    getMock.mockResolvedValue([group({ matchesAnswerFile: true })]);

    renderPanel();

    expect(await screen.findByText('Matches the instructor reference solution.')).toBeInTheDocument();
  });

  it('folds common matches away, and says what they are', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([
      group({ matchId: 'common-1', studentCount: 14, identicalStudentCount: 14 }),
    ]);

    renderPanel();

    expect(
      await screen.findByText('No matches worth reviewing. 1 common answer set aside.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Common matches (1)' })).toBeInTheDocument();
    // Collapsed to start: the card is not in the document until it is asked for.
    expect(screen.queryByRole('heading', { name: /Common answer/ })).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /Show common matches/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await person.click(toggle);

    expect(await screen.findByRole('heading', { name: /Common answer/ })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('lets the reader move where common begins, and remembers it', async () => {
    const person = userEvent.setup();
    // 10 of 38 is over a quarter: common at the default, not common at half.
    getMock.mockResolvedValue([group({ studentCount: 10, identicalStudentCount: 10 })]);

    renderPanel();
    expect(await screen.findByRole('heading', { name: 'Common matches (1)' })).toBeInTheDocument();

    await person.click(screen.getByRole('button', { name: /Adjust/ }));
    fireEvent.change(await screen.findByLabelText('Common threshold'), {
      target: { value: '0.5' },
    });

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Common matches/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Common threshold: 50%')).toBeInTheDocument();
    expect(window.localStorage.getItem('afct.similarityCommonShare')).toBe('0.5');
  });

  it('never calls anybody suspicious, and shows no percentage of similarity', async () => {
    getMock.mockResolvedValue([group({ reusedAfterPass: true, matchesAnswerFile: true })]);

    const { container } = renderPanel();
    await screen.findByText(/2 of 38 students/);

    const text = container.textContent?.toLowerCase() ?? '';
    expect(text).not.toContain('suspicious');
    expect(text).not.toContain('plagiar');
    expect(text).not.toContain('cheat');
    // No implementation vocabulary either.
    expect(text).not.toContain('hash');
  });

  it('opens the comparison from the card, earliest student first', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([group()]);
    renderPanel();
    await screen.findByText(/2 of 38 students/);

    await person.click(screen.getByRole('button', { name: /Compare submissions/ }));

    await waitFor(() => expect(screen.getByTestId('compare')).toBeInTheDocument());
    expect(screen.getByTestId('compare').textContent).toBe('sub-2 vs sub-1');
  });
});
