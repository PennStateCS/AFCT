/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
// decides. Its own contract (two panes, the right files) is covered where it lives.
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

const group = (over: Record<string, unknown> = {}) => ({
  matchId: 'abcd1234',
  problem: { id: 'p1', title: 'Even zeros', type: 'FA' },
  studentCount: 2,
  problemStudentCount: 40,
  identicalStudentCount: 2,
  closestGapMs: 6 * 60 * 1000,
  reusedAfterPass: false,
  matchesAnswerFile: false,
  submissions: [
    {
      id: 'sub-1',
      submittedAt: '2026-08-14T12:00:00.000Z',
      assignmentId: 'a1',
      fileName: 'stored-1.jff',
      originalFileName: 'mine.jff',
      student: student('s1', 'Ada'),
      studentGroup: null,
    },
    {
      id: 'sub-2',
      submittedAt: '2026-08-14T11:54:00.000Z',
      assignmentId: 'a1',
      fileName: 'stored-2.jff',
      originalFileName: 'answer.jff',
      student: student('s2', 'Grace'),
      studentGroup: null,
    },
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
});

describe('AssignmentSimilarityPanel', () => {
  it('answers the question in one line when there is nothing to read', async () => {
    renderPanel();

    expect(await screen.findByText('No two students submitted matching work.')).toBeInTheDocument();
  });

  it('summarises what there is before any of the detail', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    expect(await screen.findByText('1 set of matching work across 1 problem.')).toBeInTheDocument();
  });

  it('says how much of the class shares it, and how far apart they submitted', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    expect(await screen.findByText('2 of 40 students submitted the identical file')).toBeInTheDocument();
    expect(screen.getByText('6 minutes apart')).toBeInTheDocument();
    expect(screen.getByText('Ada Student')).toBeInTheDocument();
    expect(screen.getByText('Grace Student')).toBeInTheDocument();
  });

  it('groups the cards under their problem', async () => {
    getMock.mockResolvedValue([
      group(),
      group({
        matchId: 'ffff0000',
        problem: { id: 'p2', title: 'a^n b^n', type: 'CFG' },
        studentCount: 25,
        problemStudentCount: 40,
        identicalStudentCount: 25,
      }),
    ]);

    renderPanel();

    expect(await screen.findByRole('heading', { name: 'Even zeros' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'a^n b^n' })).toBeInTheDocument();
    expect(
      screen.getByText('2 sets of matching work across 2 problems, 1 of them shared by much of the class.'),
    ).toBeInTheDocument();
  });

  it('says when the same work was submitted drawn differently', async () => {
    getMock.mockResolvedValue([group({ studentCount: 2, identicalStudentCount: 1 })]);

    renderPanel();

    expect(
      await screen.findByText('2 of 40 students submitted the same work, drawn differently'),
    ).toBeInTheDocument();
  });

  it('separates the students who submitted the very same file from the rest', async () => {
    getMock.mockResolvedValue([group({ studentCount: 3, identicalStudentCount: 2 })]);

    renderPanel();

    expect(
      await screen.findByText('3 of 40 students submitted the same work, 2 of them the identical file'),
    ).toBeInTheDocument();
  });

  it('explains a match most of the class shares rather than hiding it', async () => {
    getMock.mockResolvedValue([
      group({ studentCount: 25, problemStudentCount: 40, identicalStudentCount: 25 }),
    ]);

    renderPanel();

    expect(await screen.findByText('Common')).toBeInTheDocument();
    expect(screen.getByText(/probably just the answer/)).toBeInTheDocument();
  });

  it('says plainly when a file was submitted after the same one had already passed', async () => {
    getMock.mockResolvedValue([group({ reusedAfterPass: true })]);

    renderPanel();

    expect(await screen.findByText('Reused after passing')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This exact file had already been marked correct for another student when it was submitted again.',
      ),
    ).toBeInTheDocument();
    // And it leads the summary, because it is what a reader with thirty seconds needs.
    expect(
      screen.getByText(/^1 of them submitted after the same file had already passed\./),
    ).toBeInTheDocument();
  });

  it('lists the students in the order they submitted, and says who was first', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();
    await screen.findByText(/2 of 40 students/);

    const names = screen.getAllByText(/Student$/).map((node) => node.textContent);
    expect(names).toEqual(['Grace Student', 'Ada Student']);
    expect(screen.getByText('First')).toBeInTheDocument();
  });

  it('shows the time of day, not just the date', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    // "6 minutes apart" is no use without knowing which side of it each student is on.
    expect(await screen.findByText(/08\/14\/26 11:54 AM UTC/)).toBeInTheDocument();
    expect(screen.getByText(/08\/14\/26 12:00 PM UTC/)).toBeInTheDocument();
  });

  it('lets the reader move where common begins', async () => {
    const person = userEvent.setup();
    // 10 of 40 is a quarter: common at the default, not common below it.
    getMock.mockResolvedValue([
      group({ studentCount: 10, problemStudentCount: 40, identicalStudentCount: 10 }),
    ]);

    renderPanel();
    expect(await screen.findByText('Common')).toBeInTheDocument();

    const slider = screen.getByLabelText('Treat as the answer at');
    await person.clear(slider).catch(() => {});
    fireEvent.change(slider, { target: { value: '0.5' } });

    await waitFor(() => expect(screen.queryByText('Common')).not.toBeInTheDocument());
    expect(screen.getByText(/50% of a problem/)).toBeInTheDocument();
  });

  it('says when the matching work is simply the posted answer', async () => {
    getMock.mockResolvedValue([group({ matchesAnswerFile: true })]);

    renderPanel();

    expect(await screen.findByText('The posted answer')).toBeInTheDocument();
    expect(screen.getByText(/reference solution/)).toBeInTheDocument();
  });

  it('never calls anybody suspicious', async () => {
    getMock.mockResolvedValue([group()]);

    const { container } = renderPanel();
    await screen.findByText(/2 of 40 students/);

    expect(container.textContent?.toLowerCase()).not.toContain('suspicious');
    expect(container.textContent?.toLowerCase()).not.toContain('plagiar');
  });

  it('opens the two files side by side', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([group()]);
    renderPanel();
    await screen.findByText(/2 of 40 students/);

    await person.click(screen.getByRole('button', { name: /Compare files/ }));

    await waitFor(() => expect(screen.getByTestId('compare')).toBeInTheDocument());
    // Earliest first: sub-2 landed at 11:54, sub-1 at 12:00.
    expect(screen.getByTestId('compare').textContent).toBe('sub-2 vs sub-1');
  });
});
