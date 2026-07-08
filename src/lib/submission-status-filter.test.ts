import { describe, expect, it } from 'vitest';
import type { ProblemSubmission } from '@/lib/problem-submission';
import {
  filterSubmissions,
  getSubmissionReviewStatus,
  STATUS_FILTER_OPTIONS,
  type SubmissionStatusFilter,
} from '@/lib/submission-status-filter';

const sub = (over: Partial<ProblemSubmission> = {}): ProblemSubmission => ({
  id: 's1',
  submittedAt: '2026-01-10T12:00:00.000Z',
  status: 'complete',
  ...over,
});

describe('getSubmissionReviewStatus', () => {
  it.each([
    ['processing', 'processing'],
    ['pending', 'pending'],
    ['failed', 'failed'],
    ['PROCESSING', 'processing'],
  ] as const)('returns "%s" → "%s"', (status, expected) => {
    expect(getSubmissionReviewStatus(sub({ status }))).toBe(expected);
  });

  it('returns "correct" only when correct is strictly true', () => {
    expect(getSubmissionReviewStatus(sub({ status: 'complete', correct: true }))).toBe('correct');
  });

  it('falls back to "incorrect" for terminal-but-not-correct submissions', () => {
    expect(getSubmissionReviewStatus(sub({ status: 'complete', correct: false }))).toBe('incorrect');
    expect(getSubmissionReviewStatus(sub({ status: 'complete' }))).toBe('incorrect');
  });
});

describe('filterSubmissions', () => {
  const due = new Date('2026-01-10T12:00:00.000Z');
  const onTime = sub({ id: 'ok', submittedAt: '2026-01-10T10:00:00.000Z', correct: true });
  const lateByTime = sub({ id: 'late', submittedAt: '2026-01-10T14:00:00.000Z', correct: false });
  const lateByStatus = sub({ id: 'late2', status: 'late', submittedAt: '2026-01-10T09:00:00.000Z' });
  const pending = sub({ id: 'pend', status: 'pending', submittedAt: '2026-01-10T09:00:00.000Z' });
  const all = [onTime, lateByTime, lateByStatus, pending];

  const filter = (...f: SubmissionStatusFilter[]) =>
    filterSubmissions(all, new Set(f), due, true).map((s) => s.id);

  it('returns everything when no filters are active', () => {
    expect(filterSubmissions(all, new Set(), due, true)).toEqual(all);
  });

  it('selects late submissions by explicit status or by time', () => {
    expect(filter('late').sort()).toEqual(['late', 'late2']);
  });

  it('selects on-time submissions (not late)', () => {
    // pending + onTime were submitted before the due date; lateByStatus is "late".
    expect(filter('on-time').sort()).toEqual(['ok', 'pend']);
  });

  it('selects by review status', () => {
    expect(filter('correct')).toEqual(['ok']);
    expect(filter('pending')).toEqual(['pend']);
  });

  it('unions multiple active filters', () => {
    expect(filter('correct', 'pending').sort()).toEqual(['ok', 'pend']);
  });

  it('ignores the due date when hasValidDueDate is false', () => {
    // Without a valid due date, only the explicit "late" status counts as late.
    const ids = filterSubmissions(all, new Set(['late'] as SubmissionStatusFilter[]), null, false).map(
      (s) => s.id,
    );
    expect(ids).toEqual(['late2']);
  });
});

describe('STATUS_FILTER_OPTIONS', () => {
  it('exposes one option per filter value with a label and dot class', () => {
    expect(STATUS_FILTER_OPTIONS).toHaveLength(7);
    for (const opt of STATUS_FILTER_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.dot).toMatch(/^bg-/);
    }
  });
});
