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
  maxPoints: 10,
  pointsLostMean: null,
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

const distribution = (over: Partial<Payload['histogram']> = {}): Payload['histogram'] => ({
  bins: [],
  includedCount: 0,
  excludedCount: 0,
  mean: null,
  median: null,
  low: null,
  high: null,
  waitingOn: [],
  notSubmitted: [],
  noPossiblePoints: false,
  ...over,
});

const payload = (over: Partial<Payload> = {}): Payload => ({
  unit: 'student',
  participantCount: 2,
  exceptionCount: 0,
  exclusions: [],
  histogram: distribution(),
  histogramCountingMissingAsZero: distribution(),
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

  it('says what the excluded work is waiting on, not just how much there is', async () => {
    serve(
      payload({
        histogram: distribution({
          includedCount: 4,
          excludedCount: 12,
          mean: 85,
          median: 87.5,
          low: 62,
          high: 100,
          waitingOn: [{ problemId: 'p3', title: 'Pumping lemma', count: 10 }],
        }),
      }),
    );

    renderPanel();

    expect(
      await screen.findByText(
        /12 were left out as not yet fully scored: 10 waiting on Pumping lemma\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('4 graded \u00b7 mean 85% \u00b7 median 88% \u00b7 range 62% to 100%'),
    ).toBeInTheDocument();
  });

  it('does not send the professor to mark work nobody handed in', async () => {
    serve(
      payload({
        histogram: distribution({
          includedCount: 3,
          excludedCount: 15,
          mean: 67,
          waitingOn: [{ problemId: 'p1', title: 'Regular expressions', count: 2 }],
          notSubmitted: [{ problemId: 'p2', title: 'Three Consecutive 1s', count: 13 }],
        }),
        histogramCountingMissingAsZero: distribution({ includedCount: 16, mean: 12 }),
      }),
    );

    renderPanel();

    expect(
      await screen.findByText(
        /2 waiting on Regular expressions, 13 did not submit Three Consecutive 1s\./,
      ),
    ).toBeInTheDocument();
  });

  it('says so plainly when there are no points to award', async () => {
    serve(
      payload({
        histogram: distribution({ excludedCount: 2, noPossiblePoints: true }),
      }),
    );

    renderPanel();

    expect(
      await screen.findByText(/no points to award, so there is no score to chart/),
    ).toBeInTheDocument();
  });

  it('opens any card full screen, and opens the heatmap before showing it', async () => {
    const person = (await import('@testing-library/user-event')).default.setup();
    serve(payload({ heatmap: { matrix: [], max: 4 } }));

    renderPanel();

    // Every chart card offers it, named for the card so one button is not five.
    await person.click(
      await screen.findByRole('button', { name: 'View Grading progress full screen' }),
    );
    expect(await screen.findByRole('dialog', { name: 'Grading progress' })).toBeInTheDocument();
    await person.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The folded card is a special case: expanding it must not show a dialog of something
    // the page is hiding.
    const disclosure = screen.getByRole('button', { name: 'When submissions happen' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    await person.click(
      screen.getByRole('button', { name: 'View When submissions happen full screen' }),
    );

    expect(
      await screen.findByRole('dialog', { name: 'When submissions happen' }),
    ).toBeInTheDocument();
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  });

  it('offers to count missing work as zero, and never does it unasked', async () => {
    const person = (await import('@testing-library/user-event')).default.setup();
    serve(
      payload({
        // Four handed in, two never did: the two readings differ, so the choice is real.
        histogram: distribution({ includedCount: 4, excludedCount: 2, mean: 80, median: 80 }),
        histogramCountingMissingAsZero: distribution({
          includedCount: 6,
          excludedCount: 0,
          mean: 53,
          median: 60,
        }),
      }),
    );

    renderPanel();

    // Off to begin with: the page does not decide that a missing submission is a zero.
    expect(await screen.findByText(/^4 graded/)).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: /Count work nobody submitted as zero/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await person.click(toggle);

    expect(screen.getByText(/^6 counted/)).toBeInTheDocument();
    expect(screen.getByText(/mean 53%/)).toBeInTheDocument();
  });

  it('does not offer the choice when it would change nothing', async () => {
    // Everybody handed something in, so zeroing missing work moves no number.
    serve(
      payload({
        histogram: distribution({ includedCount: 5, mean: 70, median: 70 }),
        histogramCountingMissingAsZero: distribution({ includedCount: 5, mean: 70, median: 70 }),
      }),
    );

    renderPanel();

    expect(await screen.findByText(/^5 graded/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('keeps the heatmap folded away until it is asked for', async () => {
    serve(payload({ heatmap: { matrix: [], max: 3 } }));

    const person = (await import('@testing-library/user-event')).default.setup();
    renderPanel();

    // Two controls carry that name now: the disclosure, and the one that opens it full
    // screen. This case is about the disclosure.
    const trigger = await screen.findByRole('button', { name: 'When submissions happen' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await person.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
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
