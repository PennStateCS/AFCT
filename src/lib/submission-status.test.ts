import { describe, expect, it } from 'vitest';
import type { ProblemSubmission } from '@/lib/problem-submission';
import {
  getReviewStatusChip,
  getTimingStatusChip,
} from '@/lib/submission-status';

const sub = (over: Partial<ProblemSubmission> = {}): ProblemSubmission => ({
  id: 's1',
  submittedAt: '2026-01-10T12:00:00.000Z',
  status: 'complete',
  ...over,
});

describe('getTimingStatusChip', () => {
  const due = new Date('2026-01-10T12:00:00.000Z');

  // There was a test here asserting that a status of "late" marked the chip Late whatever the
  // due date said. It passed because `ProblemSubmission.status` is typed `string`, so a test
  // can invent a value the column cannot hold: `SubmissionStatus` is PENDING, PROCESSING,
  // COMPLETED or FAILED. It pinned a branch that could never run in production.
  it('does not invent a verdict when there is no deadline to judge against', () => {
    // Every assignment has a due date (the column is not nullable), so arriving here without
    // one means the caller failed to pass it. Saying "Late" would be a guess; what this must
    // not do is quietly report the missing data as a fact, which is a live risk while the chip
    // has no third state.
    const chip = getTimingStatusChip(sub({ status: 'late' }), false, null);
    expect(chip.label).toBe('On time');
  });

  it('marks Late when submitted after a valid due date', () => {
    const chip = getTimingStatusChip(
      sub({ submittedAt: '2026-01-10T12:00:01.000Z' }),
      true,
      due,
    );
    expect(chip.label).toBe('Late');
  });

  it('marks On time when submitted at/before the due date', () => {
    const chip = getTimingStatusChip(
      sub({ submittedAt: '2026-01-10T11:59:59.000Z' }),
      true,
      due,
    );
    expect(chip).toMatchObject({ label: 'On time' });
  });

  it('treats a submission as On time when there is no valid due date', () => {
    const chip = getTimingStatusChip(sub({ submittedAt: '2030-01-01T00:00:00.000Z' }), false, null);
    expect(chip.label).toBe('On time');
  });
});

describe('getReviewStatusChip', () => {
  /**
   * Label and badge variant, which is all a chip carries now. It used to carry a `tone` as well,
   * naming one of nine dot colours; nothing ever read it, and the tables show a badge whose text
   * carries the status rather than a dot whose colour does. Asserting on the variant is what
   * keeps the distinctions the tones were protecting: Failed is the only danger here, because it
   * means the autograder broke rather than that a student got the answer wrong.
   */
  it.each([
    ['pending', 'Pending', 'neutral'],
    ['processing', 'Processing', 'info'],
    ['failed', 'Failed', 'danger'],
  ] as const)('maps status "%s" to the %s chip', (status, label, variant) => {
    expect(getReviewStatusChip(sub({ status }))).toMatchObject({ label, variant });
  });

  it('is case-insensitive on status', () => {
    expect(getReviewStatusChip(sub({ status: 'PENDING' })).label).toBe('Pending');
  });

  it('reports Correct when correct is true and status is terminal', () => {
    expect(getReviewStatusChip(sub({ status: 'complete', correct: true }))).toMatchObject({
      label: 'Correct',
    });
  });

  it('reports Incorrect when correct is false or unset', () => {
    expect(getReviewStatusChip(sub({ status: 'complete', correct: false })).label).toBe('Incorrect');
    expect(getReviewStatusChip(sub({ status: 'complete' })).label).toBe('Incorrect');
  });

  it('gives Failed and Incorrect different badge colours', () => {
    // Both land in the Grade column, and Failed means the autograder broke rather than the
    // student being wrong, so they must not read as the same thing.
    expect(getReviewStatusChip(sub({ status: 'failed' })).variant).toBe('danger');
    expect(getReviewStatusChip(sub({ status: 'complete', correct: false })).variant).toBe('warning');
  });

  it('prioritizes an in-flight status over correctness', () => {
    // A row can be flagged correct while still processing; status wins.
    expect(getReviewStatusChip(sub({ status: 'processing', correct: true })).label).toBe('Processing');
  });
});

