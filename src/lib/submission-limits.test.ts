import { describe, expect, it } from 'vitest';
import {
  effectiveMaxSubmissions,
  submissionsRemaining,
  type SubmissionGrantRow,
} from './submission-limits';

const studentGrant = (userId: string, extra: number): SubmissionGrantRow => ({
  targetType: 'STUDENT',
  userId,
  groupId: null,
  extraSubmissions: extra,
});

const groupGrant = (groupId: string, extra: number): SubmissionGrantRow => ({
  targetType: 'GROUP',
  userId: null,
  groupId,
  extraSubmissions: extra,
});

describe('effectiveMaxSubmissions', () => {
  it('returns the base cap when no grants apply', () => {
    expect(effectiveMaxSubmissions(3, [], 'stu-1')).toEqual({ max: 3, granted: 0 });
  });

  it('adds a grant targeting the student', () => {
    expect(effectiveMaxSubmissions(1, [studentGrant('stu-1', 2)], 'stu-1')).toEqual({
      max: 3,
      granted: 2,
    });
  });

  it("ignores another student's grant", () => {
    expect(effectiveMaxSubmissions(1, [studentGrant('stu-2', 2)], 'stu-1')).toEqual({
      max: 1,
      granted: 0,
    });
  });

  it("adds a grant targeting one of the student's groups", () => {
    expect(effectiveMaxSubmissions(1, [groupGrant('grp-1', 1)], 'stu-1', ['grp-1'])).toEqual({
      max: 2,
      granted: 1,
    });
  });

  it('ignores a group grant when the student is not in that group', () => {
    expect(effectiveMaxSubmissions(1, [groupGrant('grp-2', 1)], 'stu-1', ['grp-1'])).toEqual({
      max: 1,
      granted: 0,
    });
  });

  it('sums student and group grants', () => {
    const grants = [studentGrant('stu-1', 1), groupGrant('grp-1', 2)];
    expect(effectiveMaxSubmissions(1, grants, 'stu-1', ['grp-1'])).toEqual({
      max: 4,
      granted: 3,
    });
  });

  it('keeps unlimited unlimited: grants are a no-op on a base of 0 or below', () => {
    expect(effectiveMaxSubmissions(0, [studentGrant('stu-1', 5)], 'stu-1')).toEqual({
      max: null,
      granted: 0,
    });
    expect(effectiveMaxSubmissions(-1, [studentGrant('stu-1', 5)], 'stu-1')).toEqual({
      max: null,
      granted: 0,
    });
  });

  it('never lets a malformed grant shrink the cap', () => {
    expect(effectiveMaxSubmissions(2, [studentGrant('stu-1', -3)], 'stu-1')).toEqual({
      max: 2,
      granted: 0,
    });
  });
});

describe('submissionsRemaining', () => {
  it('is null for an unlimited cap', () => {
    expect(submissionsRemaining({ max: null, granted: 0 }, 7)).toBeNull();
  });

  it('subtracts used attempts and floors at zero', () => {
    expect(submissionsRemaining({ max: 3, granted: 1 }, 1)).toBe(2);
    expect(submissionsRemaining({ max: 3, granted: 1 }, 5)).toBe(0);
  });
});
