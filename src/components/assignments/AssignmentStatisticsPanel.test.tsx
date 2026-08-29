/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'c1', aid: 'a1' }) }));
vi.mock('@/hooks/use-effective-timezone', () => ({
  useEffectiveTimezone: () => ({ timezone: 'UTC', hour12: false }),
}));

import { AssignmentStatisticsPanel } from './AssignmentStatisticsPanel';
import {
  GRADING_ORDER,
  STATUS_ORDER,
  TURN_IN_ORDER,
  type AssignmentStatistics,
  type GradingStateKey,
  type StatusKey,
  type TurnInStateKey,
} from '@/lib/assignment-statistics';

type Payload = AssignmentStatistics & {
  assignmentTitle: string;
  baseDueDate: string;
  timezone: string;
};

const statusOf = (over: Partial<Record<StatusKey, number>>) =>
  STATUS_ORDER.map((key) => ({ key, count: over[key] ?? 0 }));

const gradingOf = (over: Partial<Record<GradingStateKey, number>>) =>
  GRADING_ORDER.map((key) => ({ key, count: over[key] ?? 0 }));

const turnInOf = (over: Partial<Record<TurnInStateKey, number>>) =>
  TURN_IN_ORDER.map((key) => ({ key, count: over[key] ?? 0 }));

const problem = (over: Partial<Payload['problems'][number]> = {}) => ({
  id: 'p1',
  title: 'Problem 1',
  order: 0,
  autograderEnabled: true,
  boxplot: null,
  gradedCount: 0,
  ungradedCount: 0,
  status: statusOf({ completed: 2 }),
  grading: gradingOf({ graded: 2 }),
  turnIn: turnInOf({ 'on-time': 2 }),
  firstAttemptCorrect: 0,
  firstAttemptSubmitted: 0,
  attempts: {
    buckets: [
      { label: '1', count: 0 },
      { label: '2', count: 0 },
      { label: '3', count: 0 },
      { label: '4', count: 0 },
      { label: '5+', count: 0 },
    ],
    solvedCount: 0,
    unsolvedCount: 0,
  },
  ...over,
});

const payload = (over: Partial<Payload> = {}): Payload => ({
  unit: 'student',
  participantCount: 2,
  exceptionCount: 0,
  exclusions: [],
  histogram: { bins: [], includedCount: 0, excludedCount: 0, mean: null, median: null },
  problems: [problem()],
  timeline: [],
  heatmap: { matrix: [], max: 0 },
  assignmentTitle: 'HW 1',
  baseDueDate: '2026-08-10T23:59:00.000Z',
  timezone: 'UTC',
  ...over,
});

const renderPanel = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AssignmentStatisticsPanel />
    </QueryClientProvider>,
  );
};

const serve = (body: Payload) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => body } as Response),
  );
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('AssignmentStatisticsPanel', () => {
  it('says who the figures are about, and who they are not', async () => {
    serve(
      payload({
        exclusions: [
          { reason: 'dropped', count: 2 },
          { reason: 'inactive', count: 1 },
        ],
      }),
    );

    renderPanel();

    expect(
      await screen.findByText(/Counted: enrolled, active, and assigned this work\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Not counted: 2 dropped students, 1 disabled account\./),
    ).toBeInTheDocument();
  });

  it('says nothing about exclusions when there are none', async () => {
    serve(payload());

    renderPanel();

    expect(await screen.findByText(/Counted: enrolled/)).toBeInTheDocument();
    expect(screen.queryByText(/Not counted/)).toBeNull();
  });

  it('keeps the evaluation queue off the page when nothing is in it', async () => {
    // Everything evaluated: the queue has nothing to report, and a permanent card here read
    // as progress when it was only ever plumbing.
    serve(payload());

    renderPanel();

    expect(await screen.findByText('Grading progress')).toBeInTheDocument();
    expect(screen.queryByText('In the evaluation queue')).toBeNull();
  });

  it('shows the queue while work is moving through it', async () => {
    serve(payload({ problems: [problem({ status: statusOf({ completed: 1, pending: 1 }) })] }));

    renderPanel();

    expect(await screen.findByText('In the evaluation queue')).toBeInTheDocument();
  });

  it('reports a failed evaluation as a job to do rather than as queue traffic', async () => {
    serve(payload({ problems: [problem({ status: statusOf({ completed: 1, failed: 1 }) })] }));

    renderPanel();

    expect(
      await screen.findByText(/1 submission could not be evaluated and can be run again/),
    ).toBeInTheDocument();
    // A failure stays failed until somebody reruns it, so it must not hold the queue card
    // open for the rest of term.
    expect(screen.queryByText('In the evaluation queue')).toBeNull();
  });

  it('says how many problems a person has to mark', async () => {
    serve(
      payload({
        problems: [
          problem({ id: 'p1', title: 'Problem 1', autograderEnabled: false }),
          problem({ id: 'p2', title: 'Problem 2', order: 1 }),
        ],
      }),
    );

    renderPanel();

    expect(await screen.findByText(/1 of 2 problems is graded by hand/)).toBeInTheDocument();
  });

  it('does not say "1 of 1" when the whole assignment is hand-marked', async () => {
    serve(payload({ problems: [problem({ autograderEnabled: false })] }));

    renderPanel();

    expect(await screen.findByText(/This problem is graded by hand/)).toBeInTheDocument();
  });

  it('says when some participants are measured against a different date', async () => {
    serve(
      payload({
        exceptionCount: 2,
        problems: [problem({ turnIn: turnInOf({ 'on-time': 1, late: 1 }) })],
      }),
    );

    renderPanel();

    expect(await screen.findByText('Turn-in status')).toBeInTheDocument();
    expect(screen.getByText(/2 are measured against a different due date\./)).toBeInTheDocument();
  });

  it('counts groups rather than students on a group assignment', async () => {
    serve(
      payload({
        unit: 'group',
        participantCount: 4,
        exclusions: [{ reason: 'no-group', count: 1 }],
      }),
    );

    renderPanel();

    await waitFor(() => expect(screen.getByText('4 groups')).toBeInTheDocument());
    expect(
      screen.getByText(/Not counted: 1 student is in no group and cannot submit\./),
    ).toBeInTheDocument();
  });
});
