import { describe, expect, it } from 'vitest';
import { sumProblemPoints, toEnrolled, toStudentSafeEnrolled } from './course-format';

describe('sumProblemPoints', () => {
  it('sums numeric maxPoints', () => {
    expect(sumProblemPoints([{ maxPoints: 60 }, { maxPoints: 40 }])).toBe(100);
  });

  it('treats null/undefined/non-finite as zero', () => {
    expect(
      sumProblemPoints([{ maxPoints: 10 }, { maxPoints: null }, { maxPoints: undefined }, {}]),
    ).toBe(10);
  });

  it('returns 0 for null/undefined/empty input', () => {
    expect(sumProblemPoints(null)).toBe(0);
    expect(sumProblemPoints(undefined)).toBe(0);
    expect(sumProblemPoints([])).toBe(0);
  });
});

describe('toEnrolled', () => {
  it('flattens each user with its courseRole', () => {
    const roster = [
      { role: 'FACULTY', user: { id: 'u1', firstName: 'Ada' } },
      { role: 'STUDENT', user: { id: 'u2', firstName: 'Alan' } },
    ];
    expect(toEnrolled(roster)).toEqual([
      { id: 'u1', firstName: 'Ada', courseRole: 'FACULTY' },
      { id: 'u2', firstName: 'Alan', courseRole: 'STUDENT' },
    ]);
  });

  it('returns an empty array for an empty roster', () => {
    expect(toEnrolled([])).toEqual([]);
  });
});

describe('toStudentSafeEnrolled', () => {
  const roster = [
    {
      id: 'fac',
      firstName: 'Fay',
      lastName: 'Faculty',
      email: 'fay@x.edu',
      avatar: 'a.png',
      courseRole: 'FACULTY',
    },
    { id: 'ta', firstName: 'Ty', lastName: 'Aide', email: 'ty@x.edu', courseRole: 'TA' },
    { id: 'stu', firstName: 'Sam', lastName: 'Student', email: 'sam@x.edu', courseRole: 'STUDENT' },
  ];

  it('keeps staff name/avatar but drops their email', () => {
    const safe = toStudentSafeEnrolled(roster);
    expect(safe[0]).toEqual({
      id: 'fac',
      firstName: 'Fay',
      lastName: 'Faculty',
      avatar: 'a.png',
      courseRole: 'FACULTY',
    });
    expect(safe[1]).toEqual({
      id: 'ta',
      firstName: 'Ty',
      lastName: 'Aide',
      avatar: null,
      courseRole: 'TA',
    });
    expect(JSON.stringify(safe)).not.toContain('@x.edu');
  });

  it('collapses students to a count-only placeholder with no identity', () => {
    const safe = toStudentSafeEnrolled(roster);
    expect(safe[2]).toEqual({ id: '', courseRole: 'STUDENT' });
    // The count is still derivable, but no student name/id/email is present.
    expect(safe.filter((m) => m.courseRole === 'STUDENT')).toHaveLength(1);
    expect(JSON.stringify(safe)).not.toContain('Sam');
    expect(JSON.stringify(safe)).not.toContain('stu');
  });
});
