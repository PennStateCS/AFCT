import { describe, expect, it } from 'vitest';
import { effectiveDeadline, type OverrideRow } from './effective-deadline';
import type { DeadlineFields } from './submission-window';

const base: DeadlineFields = {
  unlockAt: null,
  dueDate: new Date('2026-03-01T23:59:00Z'),
  allowLateSubmissions: true,
  lateCutoff: new Date('2026-03-03T23:59:00Z'),
};

// A STUDENT override for `student` with the given fields (nulls inherit the base).
const studentOverride = (over: Partial<OverrideRow> & { userId: string }): OverrideRow => ({
  targetType: 'STUDENT',
  groupId: null,
  unlockAt: null,
  dueDate: null,
  lateCutoff: null,
  allowLateSubmissions: null,
  ...over,
});

describe('effectiveDeadline', () => {
  it('returns the base when there is no matching override', () => {
    expect(effectiveDeadline(base, [], 'stu1')).toEqual({ ...base, source: 'base' });
  });

  it('ignores an override that targets a different student', () => {
    const overrides = [studentOverride({ userId: 'other', dueDate: new Date('2026-04-01T23:59:00Z') })];
    expect(effectiveDeadline(base, overrides, 'stu1')).toEqual({ ...base, source: 'base' });
  });

  it('applies a matching student override and inherits null fields', () => {
    const dueDate = new Date('2026-03-02T23:59:00Z'); // still before the base cutoff (03-03)
    const overrides = [studentOverride({ userId: 'stu1', dueDate })];
    expect(effectiveDeadline(base, overrides, 'stu1')).toEqual({
      unlockAt: base.unlockAt,
      dueDate,
      lateCutoff: base.lateCutoff, // inherited, and still after due so not clamped
      allowLateSubmissions: base.allowLateSubmissions,
      source: 'student-override',
    });
  });

  it('clamps an inherited cutoff up to an extended due date', () => {
    const dueDate = new Date('2026-03-10T23:59:00Z'); // past the base cutoff (03-03)
    const overrides = [studentOverride({ userId: 'stu1', dueDate })];
    const result = effectiveDeadline(base, overrides, 'stu1');
    expect(result.dueDate).toEqual(dueDate);
    expect(result.lateCutoff).toEqual(dueDate); // clamped up, window stays monotonic
  });

  it('nulls the effective cutoff when the override turns late off', () => {
    const overrides = [studentOverride({ userId: 'stu1', allowLateSubmissions: false })];
    const result = effectiveDeadline(base, overrides, 'stu1');
    expect(result.allowLateSubmissions).toBe(false);
    expect(result.lateCutoff).toBeNull();
  });

  it('clamps the due date up to unlockAt when an override would invert the window', () => {
    const unlockAt = new Date('2026-03-15T00:00:00Z'); // after the base due
    const overrides = [studentOverride({ userId: 'stu1', unlockAt })];
    const result = effectiveDeadline(base, overrides, 'stu1');
    expect(result.dueDate).toEqual(unlockAt);
    // cutoff is clamped up to the (clamped) due date too
    expect(result.lateCutoff?.getTime()).toBe(unlockAt.getTime());
  });

  it('ignores GROUP overrides for now', () => {
    const overrides: OverrideRow[] = [
      {
        targetType: 'GROUP',
        userId: null,
        groupId: 'g1',
        unlockAt: null,
        dueDate: new Date('2026-05-01T23:59:00Z'),
        lateCutoff: null,
        allowLateSubmissions: null,
      },
    ];
    expect(effectiveDeadline(base, overrides, 'stu1')).toEqual({ ...base, source: 'base' });
  });
});
