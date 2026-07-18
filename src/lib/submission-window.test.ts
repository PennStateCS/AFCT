import { describe, expect, it } from 'vitest';
import { evaluateSubmissionWindow, type DeadlineFields } from './submission-window';

const due = new Date('2026-03-01T23:59:00Z');

// Build DeadlineFields with sensible defaults so each test only states what it cares about.
const fields = (over: Partial<DeadlineFields> = {}): DeadlineFields => ({
  unlockAt: null,
  dueDate: due,
  allowLateSubmissions: false,
  lateCutoff: null,
  ...over,
});

describe('evaluateSubmissionWindow', () => {
  it('accepts an on-time submission (not late)', () => {
    const now = new Date('2026-03-01T20:00:00Z');
    expect(evaluateSubmissionWindow(fields({ allowLateSubmissions: true }), now)).toEqual({
      accepted: true,
      late: false,
    });
  });

  it('treats exactly the due instant as on time (strict >)', () => {
    expect(evaluateSubmissionWindow(fields(), due)).toEqual({ accepted: true, late: false });
  });

  it('rejects a submission before unlockAt as not-open', () => {
    const unlockAt = new Date('2026-02-25T00:00:00Z');
    const now = new Date('2026-02-24T00:00:00Z');
    expect(evaluateSubmissionWindow(fields({ unlockAt }), now)).toEqual({
      accepted: false,
      late: false,
      reason: 'not-open',
    });
  });

  it('accepts once unlockAt has passed', () => {
    const unlockAt = new Date('2026-02-25T00:00:00Z');
    const now = new Date('2026-02-26T00:00:00Z');
    expect(evaluateSubmissionWindow(fields({ unlockAt }), now)).toEqual({
      accepted: true,
      late: false,
    });
  });

  it('rejects a late submission when late is not allowed', () => {
    const now = new Date('2026-03-02T00:00:00Z');
    expect(evaluateSubmissionWindow(fields(), now)).toEqual({
      accepted: false,
      late: true,
      reason: 'late-not-allowed',
    });
  });

  it('accepts a late submission when allowed and no cutoff', () => {
    const now = new Date('2026-03-05T00:00:00Z');
    expect(evaluateSubmissionWindow(fields({ allowLateSubmissions: true }), now)).toEqual({
      accepted: true,
      late: true,
    });
  });

  it('accepts a late submission before the cutoff', () => {
    const lateCutoff = new Date('2026-03-03T23:59:00Z');
    const now = new Date('2026-03-02T12:00:00Z');
    expect(
      evaluateSubmissionWindow(fields({ allowLateSubmissions: true, lateCutoff }), now),
    ).toEqual({ accepted: true, late: true });
  });

  it('rejects a late submission past the cutoff', () => {
    const lateCutoff = new Date('2026-03-03T23:59:00Z');
    const now = new Date('2026-03-04T00:00:00Z');
    expect(
      evaluateSubmissionWindow(fields({ allowLateSubmissions: true, lateCutoff }), now),
    ).toEqual({ accepted: false, late: true, reason: 'cutoff-passed' });
  });
});
