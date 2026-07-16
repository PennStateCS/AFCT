import { describe, expect, it } from 'vitest';
import { computeLateSubmissionState } from './assignment-late-window';

// All wall-times below use UTC so the expected instants are deterministic.
const due = new Date('2026-03-01T17:00:00Z');
const afterDue = new Date('2026-03-08T17:00:00Z');
const beforeDue = new Date('2026-02-20T17:00:00Z');

const base = {
  existingAllowLate: false,
  existingLateCutoff: null as Date | null,
  dueDate: due,
  timezone: 'UTC',
};

describe('computeLateSubmissionState', () => {
  it('errors when late is enabled with no cutoff anywhere', () => {
    const result = computeLateSubmissionState({ ...base, incomingAllowLate: true });
    expect(result).toEqual({
      ok: false,
      message: 'Late submission cutoff is required when late submissions are enabled.',
    });
  });

  it('errors when late is enabled and the cutoff is cleared with an empty string', () => {
    const result = computeLateSubmissionState({
      ...base,
      incomingAllowLate: true,
      existingLateCutoff: afterDue,
      incomingLateCutoff: '',
    });
    expect(result.ok).toBe(false);
  });

  it('keeps the existing cutoff when the field is omitted', () => {
    const result = computeLateSubmissionState({
      ...base,
      incomingAllowLate: true,
      existingLateCutoff: afterDue,
    });
    expect(result).toEqual({ ok: true, allowLateSubmissions: true, lateCutoff: afterDue });
  });

  it('parses an incoming cutoff in the course timezone', () => {
    const result = computeLateSubmissionState({
      ...base,
      incomingAllowLate: true,
      incomingLateCutoff: '2026-03-08T17:00',
    });
    expect(result).toEqual({
      ok: true,
      allowLateSubmissions: true,
      lateCutoff: new Date('2026-03-08T17:00:00Z'),
    });
  });

  it('rejects an incoming cutoff before the due date', () => {
    const result = computeLateSubmissionState({
      ...base,
      incomingAllowLate: true,
      incomingLateCutoff: '2026-02-20T17:00',
    });
    expect(result).toEqual({ ok: false, message: 'Late cutoff must be on or after the due date.' });
  });

  it('rejects a kept existing cutoff that is before the due date', () => {
    // e.g. the due date moved later while the old cutoff stayed.
    const result = computeLateSubmissionState({
      ...base,
      incomingAllowLate: true,
      existingLateCutoff: beforeDue,
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a cutoff exactly at the due date', () => {
    const result = computeLateSubmissionState({
      ...base,
      incomingAllowLate: true,
      existingLateCutoff: new Date(due),
    });
    expect(result.ok).toBe(true);
  });

  it('errors when a cutoff is supplied while late submissions are disabled', () => {
    const result = computeLateSubmissionState({
      ...base,
      incomingAllowLate: false,
      incomingLateCutoff: '2026-03-08T17:00',
    });
    expect(result).toEqual({
      ok: false,
      message: 'Late cutoff provided but late submissions are disabled.',
    });
  });

  it('clears the stored cutoff when late submissions are disabled', () => {
    const result = computeLateSubmissionState({
      ...base,
      incomingAllowLate: false,
      existingLateCutoff: afterDue,
    });
    expect(result).toEqual({ ok: true, allowLateSubmissions: false, lateCutoff: null });
  });

  it('falls back to the existing allow-late flag when the field is omitted', () => {
    const kept = computeLateSubmissionState({
      ...base,
      existingAllowLate: true,
      existingLateCutoff: afterDue,
    });
    expect(kept).toEqual({ ok: true, allowLateSubmissions: true, lateCutoff: afterDue });

    const keptOff = computeLateSubmissionState({ ...base });
    expect(keptOff).toEqual({ ok: true, allowLateSubmissions: false, lateCutoff: null });
  });
});
