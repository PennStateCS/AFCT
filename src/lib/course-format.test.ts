import { describe, expect, it } from 'vitest';
import { sumProblemPoints, toEnrolled } from './course-format';

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
