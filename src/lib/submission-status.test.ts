import { describe, expect, it } from 'vitest';
import type { ProblemSubmission } from '@/lib/problem-submission';
import {
  getReviewStatusChip,
  getTimingStatusChip,
  statusToneClass,
} from '@/lib/submission-status';

const sub = (over: Partial<ProblemSubmission> = {}): ProblemSubmission => ({
  id: 's1',
  submittedAt: '2026-01-10T12:00:00.000Z',
  status: 'complete',
  ...over,
});

describe('getTimingStatusChip', () => {
  const due = new Date('2026-01-10T12:00:00.000Z');

  it('marks a submission Late when its status is "late", ignoring the due date', () => {
    const chip = getTimingStatusChip(sub({ status: 'late' }), false, null);
    expect(chip).toMatchObject({ label: 'Late', tone: 'amber' });
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
    expect(chip).toMatchObject({ label: 'On time', tone: 'green' });
  });

  it('treats a submission as On time when there is no valid due date', () => {
    const chip = getTimingStatusChip(sub({ submittedAt: '2030-01-01T00:00:00.000Z' }), false, null);
    expect(chip.label).toBe('On time');
  });
});

describe('getReviewStatusChip', () => {
  it.each([
    ['pending', 'Pending', 'violet'],
    ['processing', 'Processing', 'yellow'],
    ['failed', 'Failed', 'pink'],
  ] as const)('maps status "%s" to the %s chip', (status, label, tone) => {
    expect(getReviewStatusChip(sub({ status }))).toMatchObject({ label, tone });
  });

  it('is case-insensitive on status', () => {
    expect(getReviewStatusChip(sub({ status: 'PENDING' })).label).toBe('Pending');
  });

  it('reports Correct when correct is true and status is terminal', () => {
    expect(getReviewStatusChip(sub({ status: 'complete', correct: true }))).toMatchObject({
      label: 'Correct',
      tone: 'blue',
    });
  });

  it('reports Incorrect when correct is false or unset', () => {
    expect(getReviewStatusChip(sub({ status: 'complete', correct: false })).label).toBe('Incorrect');
    expect(getReviewStatusChip(sub({ status: 'complete' })).label).toBe('Incorrect');
  });

  it('prioritizes an in-flight status over correctness', () => {
    // A row can be flagged correct while still processing; status wins.
    expect(getReviewStatusChip(sub({ status: 'processing', correct: true })).label).toBe('Processing');
  });
});

describe('statusToneClass', () => {
  it('provides a class for every tone a chip can produce', () => {
    expect(statusToneClass.amber).toMatch(/^bg-/);
    expect(statusToneClass.green).toMatch(/^bg-/);
    expect(statusToneClass.blue).toMatch(/^bg-/);
    expect(Object.keys(statusToneClass)).toHaveLength(9);
  });
});
