import { describe, expect, it } from 'vitest';
import { COMMON_SHARE, isCommon, subjectCountsOf } from './rarity';

/**
 * A match's counts, both ways round. `studentCount` and `groupCount` are deliberately free
 * to disagree: on a group assignment two teams of five that share work are two subjects and
 * ten students, and which of those the threshold is applied to changes the answer.
 */
const counts = (over: Partial<Parameters<typeof isCommon>[0]> = {}) => ({
  studentCount: 2,
  problemStudentCount: 10,
  groupCount: 0,
  problemGroupCount: 0,
  ...over,
});

describe('isCommon on an individual assignment', () => {
  it('is not common at 2 of 10 students', () => {
    expect(isCommon(counts(), COMMON_SHARE, 'student')).toBe(false);
  });

  it('is common at 3 of 10 students', () => {
    expect(isCommon(counts({ studentCount: 3 }), COMMON_SHARE, 'student')).toBe(true);
  });

  it('treats the boundary itself as common', () => {
    // The same inclusive rule the feature-level filter uses, so one number means one thing.
    expect(isCommon(counts({ studentCount: 1, problemStudentCount: 4 }), COMMON_SHARE, 'student')).toBe(
      true,
    );
  });
});

describe('isCommon on a group assignment', () => {
  it('is not common at 2 of 9 groups', () => {
    expect(
      isCommon(counts({ groupCount: 2, problemGroupCount: 9 }), COMMON_SHARE, 'group'),
    ).toBe(false);
  });

  it('is common at 3 of 9 groups', () => {
    expect(
      isCommon(counts({ groupCount: 3, problemGroupCount: 9 }), COMMON_SHARE, 'group'),
    ).toBe(true);
  });

  it('counts teams, not their members, when the two disagree', () => {
    // Nine teams submitted. Two of them share work, and between them they hold eight of the
    // twenty-eight students who submitted: 29% of the students, 22% of the teams. Counted by
    // student this would be filed away as the expected answer and never read.
    const match = counts({
      studentCount: 8,
      problemStudentCount: 28,
      groupCount: 2,
      problemGroupCount: 9,
    });

    expect(isCommon(match, COMMON_SHARE, 'group')).toBe(false);
    expect(isCommon(match, COMMON_SHARE, 'student')).toBe(true);
  });

  it('and the other way round: few students, enough teams', () => {
    // Three one-person teams out of nine. 33% of the teams, 12% of the students.
    const match = counts({
      studentCount: 3,
      problemStudentCount: 25,
      groupCount: 3,
      problemGroupCount: 9,
    });

    expect(isCommon(match, COMMON_SHARE, 'group')).toBe(true);
    expect(isCommon(match, COMMON_SHARE, 'student')).toBe(false);
  });

  it('falls back to students when the work carries no group at all', () => {
    // Submissions from before AFCT recorded groups. A group numerator over a student
    // denominator would be a number about nothing, so it says what it can say truthfully.
    const legacy = counts({ studentCount: 3, problemStudentCount: 10 });

    expect(subjectCountsOf(legacy, 'group')).toEqual({ sharing: 3, total: 10, noun: 'student' });
    expect(isCommon(legacy, COMMON_SHARE, 'group')).toBe(true);
  });
});
