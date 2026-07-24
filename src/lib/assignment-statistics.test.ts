import { describe, it, expect } from 'vitest';
import {
  assignmentPercentage,
  quantileSorted,
  medianOf,
  meanOf,
  computeScoreHistogram,
  computeBoxPlot,
  queueStatusKey,
  computeAttemptsToSolve,
  computeFirstAttemptSuccess,
  computeSubmissionTimeline,
  computeActivityHeatmap,
  heatmapLevel,
  buildAssignmentStatistics,
  STATUS_ORDER,
  type StatsParticipant,
  type StatsProblem,
  type StatsSubmission,
} from './assignment-statistics';

// Build a submission event; time given as a UTC ISO string for readability.
const sub = (
  participantId: string,
  problemId: string,
  iso: string,
  correct = false,
): StatsSubmission => ({
  participantId,
  problemId,
  submittedAt: new Date(iso).getTime(),
  correct,
});

describe('assignmentPercentage', () => {
  it('divides earned by possible', () => {
    expect(assignmentPercentage(45, 50)).toBe(90);
    expect(assignmentPercentage(0, 50)).toBe(0); // a real zero is 0%, not excluded here
    expect(assignmentPercentage(50, 50)).toBe(100);
  });
  it('returns null when there are no possible points', () => {
    expect(assignmentPercentage(0, 0)).toBeNull();
    expect(assignmentPercentage(5, 0)).toBeNull();
  });
});

describe('quantile / mean / median', () => {
  it('interpolates quantiles like d3/R-7', () => {
    const s = [1, 2, 3, 4]; // n=4
    expect(quantileSorted(s, 0.25)).toBeCloseTo(1.75, 10);
    expect(quantileSorted(s, 0.5)).toBeCloseTo(2.5, 10);
    expect(quantileSorted(s, 0.75)).toBeCloseTo(3.25, 10);
  });
  it('median of odd and even counts', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });
  it('mean guards empty', () => {
    expect(meanOf([2, 4])).toBe(3);
    expect(meanOf([])).toBeNull();
  });
});

describe('computeScoreHistogram bin boundaries', () => {
  it('puts 0% in the first bin and 100% in the last (right-closed)', () => {
    const { bins } = computeScoreHistogram([0, 100]);
    expect(bins).toHaveLength(10);
    expect(bins[0]!.count).toBe(1); // 0 -> 0-10%
    expect(bins[9]!.count).toBe(1); // 100 -> 90-100%
    expect(bins[9]!.isLast).toBe(true);
    expect(bins[9]!.label).toBe('90-100%');
  });
  it('a value on a bin edge goes to the upper bin (lower-inclusive)', () => {
    const { bins } = computeScoreHistogram([10, 20, 90]);
    expect(bins[1]!.count).toBe(1); // 10 -> 10-20%
    expect(bins[2]!.count).toBe(1); // 20 -> 20-30%
    expect(bins[9]!.count).toBe(1); // 90 -> 90-100% (last bin)
  });
  it('99.9% stays out of the last bin, 100% lands in it', () => {
    const { bins } = computeScoreHistogram([99.9, 100]);
    expect(bins[9]!.count).toBe(2); // 99.9 -> 90-100%, 100 -> 90-100%
    const only = computeScoreHistogram([89.999]).bins;
    expect(only[8]!.count).toBe(1); // 89.999 -> 80-90%
  });
  it('clamps out-of-range values onto the axis', () => {
    const { bins } = computeScoreHistogram([-5, 150]);
    expect(bins[0]!.count).toBe(1); // -5 clamped to 0
    expect(bins[9]!.count).toBe(1); // 150 clamped to 100
  });
  it('reports mean and median of the included values', () => {
    const h = computeScoreHistogram([50, 100]);
    expect(h.mean).toBe(75);
    expect(h.median).toBe(75);
    expect(computeScoreHistogram([]).mean).toBeNull();
  });
});

describe('computeBoxPlot (Tukey)', () => {
  it('returns null for an empty sample', () => {
    expect(computeBoxPlot([])).toBeNull();
  });
  it('computes quartiles, whiskers, mean without outliers', () => {
    const b = computeBoxPlot([10, 20, 30, 40])!;
    expect(b.q1).toBeCloseTo(17.5, 10);
    expect(b.median).toBeCloseTo(25, 10);
    expect(b.q3).toBeCloseTo(32.5, 10);
    expect(b.mean).toBeCloseTo(25, 10);
    // IQR=15, fences [17.5-22.5, 32.5+22.5] = [-5, 55]; all in range
    expect(b.whiskerLow).toBe(10);
    expect(b.whiskerHigh).toBe(40);
    expect(b.outliers).toEqual([]);
    expect(b.count).toBe(4);
  });
  it('flags a high outlier and trims the whisker to the last in-fence value', () => {
    // 1..9 have Q1=3, Q3=7, IQR=4, upper fence 13; 100 is an outlier.
    const b = computeBoxPlot([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])!;
    expect(b.outliers).toEqual([100]);
    expect(b.whiskerHigh).toBe(9);
    expect(b.whiskerLow).toBe(1);
    expect(b.max).toBe(100); // raw max still recorded
  });
  it('handles a single value', () => {
    const b = computeBoxPlot([42])!;
    expect(b.q1).toBe(42);
    expect(b.median).toBe(42);
    expect(b.q3).toBe(42);
    expect(b.whiskerLow).toBe(42);
    expect(b.whiskerHigh).toBe(42);
    expect(b.outliers).toEqual([]);
  });
});

describe('queueStatusKey', () => {
  it('maps each queue state onto its bucket', () => {
    expect(queueStatusKey('COMPLETED')).toBe('completed');
    expect(queueStatusKey('PROCESSING')).toBe('processing');
    expect(queueStatusKey('PENDING')).toBe('pending');
    expect(queueStatusKey('FAILED')).toBe('failed');
  });
  it('treats an absent submission as missing', () => {
    expect(queueStatusKey(undefined)).toBe('missing');
  });
});

describe('buildAssignmentStatistics', () => {
  const problems: StatsProblem[] = [
    { id: 'p1', title: 'Problem 1', order: 0, maxPoints: 10 },
    { id: 'p2', title: 'Problem 2', order: 1, maxPoints: 10 },
  ];

  const mkParticipant = (over: Partial<StatsParticipant> & { id: string }): StatsParticipant => ({
    hasException: false,
    problemGrades: {},
    latestStatusByProblem: {},
    ...over,
  });

  // Status counts for one problem id, as a { statusKey: count } map.
  const statusOf = (stats: ReturnType<typeof buildAssignmentStatistics>, problemId: string) => {
    const p = stats.problems.find((pr) => pr.id === problemId)!;
    return Object.fromEntries(p.status.map((s) => [s.key, s.count]));
  };

  it('excludes ungraded assignments from the histogram and counts them', () => {
    const participants = [
      // fully graded 100%
      mkParticipant({ id: 's1', problemGrades: { p1: 10, p2: 10 } }),
      // fully graded, a real zero -> 0%, included
      mkParticipant({ id: 's2', problemGrades: { p1: 0, p2: 0 } }),
      // only one problem graded -> excluded
      mkParticipant({ id: 's3', problemGrades: { p1: 10 } }),
      // nothing graded -> excluded
      mkParticipant({ id: 's4' }),
    ];
    const stats = buildAssignmentStatistics({ unit: 'student', problems, participants, submissions: [], timeZone: 'UTC' });
    expect(stats.histogram.includedCount).toBe(2);
    expect(stats.histogram.excludedCount).toBe(2);
    // s1 -> 100% (last bin), s2 -> 0% (first bin)
    expect(stats.histogram.bins[0]!.count).toBe(1);
    expect(stats.histogram.bins[9]!.count).toBe(1);
    expect(stats.histogram.mean).toBe(50);
  });

  it('box plots use only graded participants and report ungraded counts', () => {
    const participants = [
      mkParticipant({ id: 's1', problemGrades: { p1: 10, p2: 5 } }), // p1 100%, p2 50%
      mkParticipant({ id: 's2', problemGrades: { p1: 0 } }), // p1 0%, p2 ungraded
      mkParticipant({ id: 's3' }), // nothing graded
    ];
    const stats = buildAssignmentStatistics({ unit: 'student', problems, participants, submissions: [], timeZone: 'UTC' });
    const p1 = stats.problems.find((p) => p.id === 'p1')!;
    const p2 = stats.problems.find((p) => p.id === 'p2')!;
    expect(p1.gradedCount).toBe(2);
    expect(p1.ungradedCount).toBe(1);
    expect(p1.boxplot!.median).toBeCloseTo(50, 10); // [0, 100] -> median 50
    expect(p2.gradedCount).toBe(1);
    expect(p2.ungradedCount).toBe(2);
    expect(p2.boxplot!.median).toBeCloseTo(50, 10);
  });

  it('keeps problems in assignment order', () => {
    const unordered: StatsProblem[] = [
      { id: 'b', title: 'B', order: 1, maxPoints: 10 },
      { id: 'a', title: 'A', order: 0, maxPoints: 10 },
    ];
    const stats = buildAssignmentStatistics({
      unit: 'student',
      problems: unordered,
      participants: [],
      submissions: [],
      timeZone: 'UTC',
    });
    expect(stats.problems.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('reports the per-problem queue status, in order, summing to the participant count', () => {
    const participants = [
      // p1 evaluated, p2 still queued
      mkParticipant({ id: 'a', latestStatusByProblem: { p1: 'COMPLETED', p2: 'PENDING' } }),
      // p1 being evaluated, p2 failed
      mkParticipant({ id: 'b', latestStatusByProblem: { p1: 'PROCESSING', p2: 'FAILED' } }),
      // nothing submitted at all -> both missing
      mkParticipant({ id: 'c' }),
    ];
    const stats = buildAssignmentStatistics({ unit: 'student', problems, participants, submissions: [], timeZone: 'UTC' });

    for (const p of stats.problems) {
      expect(p.status.map((s) => s.key)).toEqual([...STATUS_ORDER]);
      expect(p.status.reduce((n, s) => n + s.count, 0)).toBe(3);
    }

    const p1 = statusOf(stats, 'p1');
    expect(p1['completed']).toBe(1); // a
    expect(p1['processing']).toBe(1); // b
    expect(p1['missing']).toBe(1); // c

    const p2 = statusOf(stats, 'p2');
    expect(p2['pending']).toBe(1); // a
    expect(p2['failed']).toBe(1); // b
    expect(p2['missing']).toBe(1); // c
  });

  it('uses the latest submission and counts an absent one as missing', () => {
    const participants = [
      mkParticipant({ id: 's1', latestStatusByProblem: { p1: 'FAILED' } }), // p1 failed, p2 missing
    ];
    const stats = buildAssignmentStatistics({ unit: 'student', problems, participants, submissions: [], timeZone: 'UTC' });
    expect(statusOf(stats, 'p1')['failed']).toBe(1);
    expect(statusOf(stats, 'p1')['missing']).toBe(0);
    expect(statusOf(stats, 'p2')['missing']).toBe(1);
  });

  it('status is independent of grades (a graded problem with no submission is missing)', () => {
    // A manual grade does not create a submission, so the queue status stays "missing".
    const participants = [mkParticipant({ id: 'manual', problemGrades: { p1: 10, p2: 10 } })];
    const stats = buildAssignmentStatistics({ unit: 'student', problems, participants, submissions: [], timeZone: 'UTC' });
    expect(statusOf(stats, 'p1')['missing']).toBe(1);
    expect(statusOf(stats, 'p1')['completed']).toBe(0);
    // ...but the grade still lands in the histogram.
    expect(stats.histogram.includedCount).toBe(1);
  });

  it('counts due-date exceptions among participants', () => {
    const participants = [
      mkParticipant({ id: 's1', hasException: true }),
      mkParticipant({ id: 's2', hasException: true }),
      mkParticipant({ id: 's3' }),
    ];
    const stats = buildAssignmentStatistics({ unit: 'student', problems, participants, submissions: [], timeZone: 'UTC' });
    expect(stats.exceptionCount).toBe(2);
    expect(stats.participantCount).toBe(3);
  });

  it('carries the unit through (groups vs students)', () => {
    const groupStats = buildAssignmentStatistics({
      unit: 'group',
      problems,
      participants: [mkParticipant({ id: 'g1', problemGrades: { p1: 10, p2: 10 } })],
      submissions: [],
      timeZone: 'UTC',
    });
    expect(groupStats.unit).toBe('group');
    expect(groupStats.participantCount).toBe(1);
  });
});

describe('computeAttemptsToSolve', () => {
  const bucketCounts = (subs: StatsSubmission[]) =>
    Object.fromEntries(computeAttemptsToSolve(subs).buckets.map((b) => [b.label, b.count]));

  it('buckets the attempt on which each pair was first solved', () => {
    const subs = [
      // s1/p1 solved on the 3rd try
      sub('s1', 'p1', '2026-08-01T10:00:00Z'),
      sub('s1', 'p1', '2026-08-01T11:00:00Z'),
      sub('s1', 'p1', '2026-08-01T12:00:00Z', true),
      // s2/p1 solved first try
      sub('s2', 'p1', '2026-08-01T10:00:00Z', true),
      // s1/p2 solved on the 6th try -> 5+
      ...Array.from({ length: 5 }, (_, i) => sub('s1', 'p2', `2026-08-0${i + 1}T09:00:00Z`)),
      sub('s1', 'p2', '2026-08-07T09:00:00Z', true),
    ];
    const counts = bucketCounts(subs);
    expect(counts['1']).toBe(1); // s2/p1
    expect(counts['3']).toBe(1); // s1/p1
    expect(counts['5+']).toBe(1); // s1/p2
    const r = computeAttemptsToSolve(subs);
    expect(r.solvedCount).toBe(3);
    expect(r.unsolvedCount).toBe(0);
  });

  it('excludes pairs that submitted but never solved, and is order-independent', () => {
    const subs = [
      // given out of order; the function sorts by time
      sub('s1', 'p1', '2026-08-01T12:00:00Z'),
      sub('s1', 'p1', '2026-08-01T10:00:00Z'),
    ];
    const r = computeAttemptsToSolve(subs);
    expect(r.solvedCount).toBe(0);
    expect(r.unsolvedCount).toBe(1);
    expect(r.buckets.every((b) => b.count === 0)).toBe(true);
  });
});

describe('computeFirstAttemptSuccess', () => {
  it('counts first-submission correctness per problem', () => {
    const subs = [
      sub('s1', 'p1', '2026-08-01T10:00:00Z', true), // first try correct
      sub('s2', 'p1', '2026-08-01T10:00:00Z'), // first try wrong
      sub('s2', 'p1', '2026-08-01T11:00:00Z', true), // later correct doesn't count
      sub('s1', 'p2', '2026-08-01T10:00:00Z', true),
    ];
    const map = computeFirstAttemptSuccess(subs);
    expect(map.get('p1')).toEqual({ correct: 1, submitted: 2 });
    expect(map.get('p2')).toEqual({ correct: 1, submitted: 1 });
  });
});

describe('computeSubmissionTimeline', () => {
  it('counts submissions per local day and zero-fills the gaps', () => {
    const subs = [
      sub('s1', 'p1', '2026-08-01T12:00:00Z'),
      sub('s2', 'p1', '2026-08-01T15:00:00Z'),
      sub('s3', 'p1', '2026-08-03T09:00:00Z'),
    ];
    expect(computeSubmissionTimeline(subs, 'UTC')).toEqual([
      { date: '2026-08-01', count: 2 },
      { date: '2026-08-02', count: 0 },
      { date: '2026-08-03', count: 1 },
    ]);
  });
  it('is empty with no submissions', () => {
    expect(computeSubmissionTimeline([], 'UTC')).toEqual([]);
  });
});

describe('computeActivityHeatmap', () => {
  it('buckets by local day-of-week and hour', () => {
    // 2026-08-03 is a Monday; 14:00 UTC.
    const { matrix, max } = computeActivityHeatmap([sub('s1', 'p1', '2026-08-03T14:00:00Z')], 'UTC');
    expect(matrix[1]![14]).toBe(1); // Monday, 14:00
    expect(max).toBe(1);
    expect(matrix[0]![0]).toBe(0);
  });
  it('uses the given timezone to place the cell', () => {
    // 02:00 UTC on Mon 2026-08-03 is 22:00 on Sun 2026-08-02 in New York (UTC-4).
    const { matrix } = computeActivityHeatmap(
      [sub('s1', 'p1', '2026-08-03T02:00:00Z')],
      'America/New_York',
    );
    expect(matrix[0]![22]).toBe(1); // Sunday, 22:00 local
    expect(matrix[1]![2]).toBe(0);
  });
});

describe('heatmapLevel', () => {
  it('is 0 for empty cells or no activity', () => {
    expect(heatmapLevel(0, 5)).toBe(0);
    expect(heatmapLevel(3, 0)).toBe(0);
  });
  it('puts the busiest cell at level 4', () => {
    expect(heatmapLevel(9, 9)).toBe(4);
  });
  it('uses a square-root scale so low counts stay visible', () => {
    // one spike of 16: a single submission (1/16) is sqrt=0.25 -> level 1, not near-zero.
    expect(heatmapLevel(1, 16)).toBe(1);
    expect(heatmapLevel(4, 16)).toBe(2); // sqrt(0.25)=0.5
    expect(heatmapLevel(9, 16)).toBe(3); // sqrt(0.5625)=0.75
  });
  it('makes every nonzero cell level 4 when they are all equal', () => {
    expect(heatmapLevel(1, 1)).toBe(4);
  });
});
