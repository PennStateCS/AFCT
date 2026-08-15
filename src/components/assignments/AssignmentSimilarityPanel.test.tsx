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
// The real submission viewer pulls in the automaton renderers, which have nothing to do
// with what this panel decides.
vi.mock('@/components/dialogs/ViewSubmissionDialog', () => ({
  ViewSubmissionDialog: ({ open, submission }: { open: boolean; submission: unknown }) =>
    open ? <div data-testid="submission-viewer">{JSON.stringify(submission)}</div> : null,
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
      submittedAt: '2026-08-14T11:00:00.000Z',
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
  it('says plainly when nothing matches', async () => {
    renderPanel();

    expect(await screen.findByText('No matching submissions')).toBeInTheDocument();
  });

  it('shows who matched and how rare the content is', async () => {
    getMock.mockResolvedValue([group()]);

    renderPanel();

    expect(await screen.findByText(/Ada Student/)).toBeInTheDocument();
    expect(screen.getByText(/Grace Student/)).toBeInTheDocument();
    expect(screen.getByText('2 of 40 students')).toBeInTheDocument();
  });

  it('marks content most of the class shares as common, rather than hiding it', async () => {
    getMock.mockResolvedValue([group({ studentCount: 25, problemStudentCount: 40 })]);

    renderPanel();

    expect(await screen.findByText('25 of 40 students')).toBeInTheDocument();
    expect(screen.getByText('Common')).toBeInTheDocument();
  });

  it('never calls anybody suspicious', async () => {
    getMock.mockResolvedValue([group()]);

    const { container } = renderPanel();
    await screen.findByText('2 of 40 students');

    expect(container.textContent?.toLowerCase()).not.toContain('suspicious');
    expect(container.textContent?.toLowerCase()).not.toContain('plagiar');
  });

  it('opens the files behind a match, one dialog at a time', async () => {
    const person = userEvent.setup();
    getMock.mockResolvedValue([group()]);
    renderPanel();
    await screen.findByText('2 of 40 students');

    await person.click(screen.getByRole('button', { name: /Manage match/ }));
    await person.click(await screen.findByText('View these submissions'));

    expect(await screen.findByText('Matching submissions')).toBeInTheDocument();

    await person.click(screen.getByRole('button', { name: "View Ada Student's submission" }));

    await waitFor(() => expect(screen.getByTestId('submission-viewer')).toBeInTheDocument());
    // The list closed rather than stacking behind the viewer.
    expect(screen.queryByText('Matching submissions')).not.toBeInTheDocument();
    expect(screen.getByTestId('submission-viewer').textContent).toContain('stored-1.jff');
  });
});
