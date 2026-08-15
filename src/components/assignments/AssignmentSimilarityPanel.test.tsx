/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
  closestGapMs: 6 * 60 * 1000,
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

    expect(await screen.findByText('No two students submitted the same file.')).toBeInTheDocument();
  });

  it('summarises what there is before any of the detail', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    expect(await screen.findByText('1 set of identical work across 1 problem.')).toBeInTheDocument();
  });

  it('says how much of the class shares it, and how far apart they submitted', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    expect(await screen.findByText(/2 of 40 students submitted identical work/)).toBeInTheDocument();
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
      }),
    ]);

    renderPanel();

    expect(await screen.findByRole('heading', { name: 'Even zeros' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'a^n b^n' })).toBeInTheDocument();
    expect(
      screen.getByText('2 sets of identical work across 2 problems, 1 of them shared by much of the class.'),
    ).toBeInTheDocument();
  });

  it('explains a match most of the class shares rather than hiding it', async () => {
    getMock.mockResolvedValue([group({ studentCount: 25, problemStudentCount: 40 })]);

    renderPanel();

    expect(await screen.findByText('Common')).toBeInTheDocument();
    expect(screen.getByText(/probably just the answer/)).toBeInTheDocument();
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
    expect(screen.getByTestId('compare').textContent).toBe('sub-1 vs sub-2');
  });
});
