import { describe, expect, it } from 'vitest';
import { evaluateSubmissionWindow } from './submission-window';

const due = new Date('2026-03-01T23:59:00Z');

describe('evaluateSubmissionWindow', () => {
  it('accepts an on-time submission (not late)', () => {
    const now = new Date('2026-03-01T20:00:00Z');
    expect(
      evaluateSubmissionWindow({ dueDate: due, allowLateSubmissions: true, lateCutoff: null }, now),
    ).toEqual({ accepted: true, late: false });
  });

  it('treats exactly the due instant as on time (strict >)', () => {
    expect(
      evaluateSubmissionWindow({ dueDate: due, allowLateSubmissions: false, lateCutoff: null }, due),
    ).toEqual({ accepted: true, late: false });
  });

  it('rejects a late submission when late is not allowed', () => {
    const now = new Date('2026-03-02T00:00:00Z');
    expect(
      evaluateSubmissionWindow({ dueDate: due, allowLateSubmissions: false, lateCutoff: null }, now),
    ).toEqual({ accepted: false, late: true, reason: 'late-not-allowed' });
  });

  it('accepts a late submission when allowed and no cutoff', () => {
    const now = new Date('2026-03-05T00:00:00Z');
    expect(
      evaluateSubmissionWindow({ dueDate: due, allowLateSubmissions: true, lateCutoff: null }, now),
    ).toEqual({ accepted: true, late: true });
  });

  it('accepts a late submission before the cutoff', () => {
    const cutoff = new Date('2026-03-03T23:59:00Z');
    const now = new Date('2026-03-02T12:00:00Z');
    expect(
      evaluateSubmissionWindow({ dueDate: due, allowLateSubmissions: true, lateCutoff: cutoff }, now),
    ).toEqual({ accepted: true, late: true });
  });

  it('rejects a late submission past the cutoff', () => {
    const cutoff = new Date('2026-03-03T23:59:00Z');
    const now = new Date('2026-03-04T00:00:00Z');
    expect(
      evaluateSubmissionWindow({ dueDate: due, allowLateSubmissions: true, lateCutoff: cutoff }, now),
    ).toEqual({ accepted: false, late: true, reason: 'cutoff-passed' });
  });
});
