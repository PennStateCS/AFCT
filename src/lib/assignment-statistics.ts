/**
 * Pure, database-free statistics for one assignment's analytics page (the Statistics
 * tab). Everything here is deterministic and side-effect free so it can be unit tested
 * without a database and reused by the server aggregator (`assignment-statistics-service`)
 * and, if needed, elsewhere.
 *
 * Two independent axes describe a participant:
 *   - SCORE (histogram, box plots): driven by recorded grades. A participant counts only
 *     when their work is graded; a real recorded zero counts, but missing/ungraded work is
 *     never silently treated as zero.
 *   - STATUS (segmented bar): the evaluation-queue state of the participant's latest
 *     submission for each problem (Completed / Processing / Pending / Failed), plus Missing
 *     when no submission exists. Grades never affect status; submissions never affect the score.
 *
 * "Participant" is a student for an individual assignment and a group for a group
 * assignment; the caller fixes the unit and never mixes the two in one result.
 */

/** The raw submission queue states (Prisma `SubmissionStatus`), before adding "missing". */
export type SubmissionQueueStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

/**
 * Status buckets shown in the Submission status chart: the four evaluation-queue states of
 * a participant's latest submission for a problem, plus `missing` when there is none.
 */
export type StatusKey = 'completed' | 'processing' | 'pending' | 'failed' | 'missing';

/** Fixed display + legend order for the status bar (graded/done first, missing last). */
export const STATUS_ORDER: readonly StatusKey[] = [
  'completed',
  'processing',
  'pending',
  'failed',
  'missing',
] as const;

/** Plain-language labels, kept here (not in the component) so tests can assert them. */
export const STATUS_LABELS: Record<StatusKey, string> = {
  completed: 'Completed',
  processing: 'Processing',
  pending: 'Pending',
  failed: 'Failed',
  missing: 'Missing',
};

/** Map a raw queue state onto its status bucket. Absence of a submission is `missing`. */
const QUEUE_STATUS_KEY: Record<SubmissionQueueStatus, StatusKey> = {
  COMPLETED: 'completed',
  PROCESSING: 'processing',
  PENDING: 'pending',
  FAILED: 'failed',
};

export function queueStatusKey(status: SubmissionQueueStatus | undefined): StatusKey {
  return status ? QUEUE_STATUS_KEY[status] : 'missing';
}

/**
 * Where a participant's work stands with the GRADER, which is not where it stands with the
 * queue.
 *
 * The queue says whether the evaluator has run. On a hand-graded problem it always finishes
 * and grades nothing, so a page reporting only the queue tells a professor "Completed" about
 * work nobody has marked. These four states answer the question that screen is actually for:
 * is there a grade, and is it still the grade for the work that is there now.
 */
export type GradingStateKey =
  /** A grade is recorded, and no work has arrived since. A recorded zero is a grade. */
  | 'graded'
  /** A grade is recorded, but the participant submitted again after it was written. */
  | 'graded-stale'
  /** Work is there and carries no grade. */
  | 'ungraded-submitted'
  /** Nothing was submitted. */
  | 'ungraded-missing';

/** Fixed display + legend order: settled first, then what is waiting, then what is absent. */
export const GRADING_ORDER: readonly GradingStateKey[] = [
  'graded',
  'graded-stale',
  'ungraded-submitted',
  'ungraded-missing',
] as const;

/** Plain-language labels, kept here (not in the component) so tests can assert them. */
export const GRADING_LABELS: Record<GradingStateKey, string> = {
  graded: 'Graded',
  'graded-stale': 'Regrade needed',
  'ungraded-submitted': 'Awaiting grading',
  'ungraded-missing': 'Nothing submitted',
};

/**
 * Whether the work arrived by the participant's own deadline.
 *
 * Judged on the attempt that HOLDS THE GRADE, which is the latest one: that is the rule the
 * rest of AFCT grades by, and judging the first submission instead would call an on-time
 * placeholder followed by the real work two days late "on time" while the grade came from
 * the late attempt. `revised-late` keeps the difference visible rather than throwing it
 * away, because a professor applying a late policy needs to know which of the two they have.
 *
 * Every participant is measured against THEIR OWN due date, so an extension is an extension
 * rather than a black mark.
 */
export type TurnInStateKey =
  /** Every attempt landed on or before their due date. */
  | 'on-time'
  /** They were on time, then submitted again after the deadline; the later work counts. */
  | 'revised-late'
  /** Nothing arrived until after their due date. */
  | 'late'
  /** Nothing arrived at all. */
  | 'missing';

/** Fixed display + legend order: on time first, nothing at all last. */
export const TURN_IN_ORDER: readonly TurnInStateKey[] = [
  'on-time',
  'revised-late',
  'late',
  'missing',
] as const;

/** Plain-language labels, kept here (not in the component) so tests can assert them. */
export const TURN_IN_LABELS: Record<TurnInStateKey, string> = {
  'on-time': 'On time',
  'revised-late': 'Revised late',
  late: 'Late',
  missing: 'Nothing submitted',
};

export const HISTOGRAM_BIN_COUNT = 10;

// ─── primitive statistics ────────────────────────────────────────────────────

/**
 * Assignment percentage: earned over possible, 0..100. Null when there are no possible
 * points, since a percentage of nothing is undefined (the caller excludes those).
 */
export function assignmentPercentage(earned: number, possible: number): number | null {
  if (!(possible > 0)) return null;
  return (earned / possible) * 100;
}

export function meanOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Quantile of an ascending-sorted array by linear interpolation between order
 * statistics (the R type-7 / d3.quantile method most charting tools use, so the box
 * plots match what people expect from other tools). `p` is 0..1.
 */
export function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return quantileSorted(sorted, 0.5);
}

// ─── histogram ───────────────────────────────────────────────────────────────

export type HistogramBin = {
  /** e.g. "0-10%" ... "90-100%". */
  label: string;
  /** Inclusive lower bound of the bin, in percent. */
  rangeStart: number;
  /** Upper bound in percent. Exclusive for every bin except the last, which includes 100. */
  rangeEnd: number;
  /** True for the final bin, which is closed on the right so 100% is counted. */
  isLast: boolean;
  count: number;
};

export type ScoreHistogram = {
  bins: HistogramBin[];
  mean: number | null;
  median: number | null;
};

/**
 * Bucket assignment percentages into ten fixed 10-point bins from 0% to 100%. Bins are
 * lower-inclusive / upper-exclusive except the last, which is closed so an exact 100%
 * lands in 90-100% rather than falling off the end. Values are clamped to [0, 100] so a
 * stray out-of-range grade can't escape the axis. Also returns the mean and median of the
 * same values for the reference lines.
 */
export function computeScoreHistogram(percentages: number[]): ScoreHistogram {
  const bins: HistogramBin[] = Array.from({ length: HISTOGRAM_BIN_COUNT }, (_, i) => ({
    label: `${i * 10}-${(i + 1) * 10}%`,
    rangeStart: i * 10,
    rangeEnd: (i + 1) * 10,
    isLast: i === HISTOGRAM_BIN_COUNT - 1,
    count: 0,
  }));

  for (const pct of percentages) {
    const clamped = Math.max(0, Math.min(100, pct));
    // 100 (and anything clamped to it) belongs in the final, right-closed bin.
    const index = clamped >= 100 ? HISTOGRAM_BIN_COUNT - 1 : Math.floor(clamped / 10);
    bins[index]!.count += 1;
  }

  return { bins, mean: meanOf(percentages), median: medianOf(percentages) };
}

// ─── box plot ────────────────────────────────────────────────────────────────

export type BoxPlotStats = {
  /** Smallest and largest raw values (before whisker trimming). */
  min: number;
  max: number;
  q1: number;
  median: number;
  q3: number;
  /** Whisker ends: the most extreme values still within 1.5 x IQR of the quartiles. */
  whiskerLow: number;
  whiskerHigh: number;
  mean: number;
  count: number;
  /** Values beyond the whiskers (Tukey outliers), sorted ascending. */
  outliers: number[];
};

/**
 * Standard Tukey box plot for one problem's normalized scores. Whiskers extend to the
 * most extreme observations within 1.5 x IQR of Q1/Q3; anything past that is an outlier.
 * Returns null for an empty sample so the caller can show an empty state.
 */
export function computeBoxPlot(values: number[]): BoxPlotStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantileSorted(sorted, 0.25);
  const median = quantileSorted(sorted, 0.5);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  const inFence = sorted.filter((v) => v >= lowerFence && v <= upperFence);
  // inFence is non-empty here: Q1 and Q3 are always within the fences, so at least the
  // observations at those positions survive.
  const whiskerLow = inFence[0]!;
  const whiskerHigh = inFence[inFence.length - 1]!;
  const outliers = sorted.filter((v) => v < lowerFence || v > upperFence);

  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    q1,
    median,
    q3,
    whiskerLow,
    whiskerHigh,
    mean: sorted.reduce((sum, v) => sum + v, 0) / sorted.length,
    count: sorted.length,
    outliers,
  };
}

// ─── submission-event aggregations ───────────────────────────────────────────

/** One raw submission event, attributed to a participant (student or group). */
export type StatsSubmission = {
  participantId: string;
  problemId: string;
  /** Submission time as epoch milliseconds (serializable + deterministic). */
  submittedAt: number;
  /** Whether the evaluator judged it correct (a null/undefined verdict is not correct). */
  correct: boolean;
  /** Where this attempt got to in the evaluation queue. */
  status: SubmissionQueueStatus;
};

/**
 * An attempt the evaluator actually judged.
 *
 * A FAILED run produced no verdict: something broke on our side and the file was never
 * assessed. Counting it as an attempt the participant got wrong reports our fault as their
 * mistake, and on a problem where the evaluator is having a bad day it does so for everybody
 * at once. It still happened, so it stays in the timeline and the heatmap, which count
 * events rather than verdicts.
 */
export function wasJudged(submission: StatsSubmission): boolean {
  return submission.status !== 'FAILED';
}

export type AttemptsBucket = { label: string; count: number };
export type AttemptsToSolve = {
  /** Buckets 1, 2, 3, 4, 5+ attempts-until-first-correct. */
  buckets: AttemptsBucket[];
  /** Participant/problem pairs that were eventually solved (the histogram's population). */
  solvedCount: number;
  /** Pairs with at least one submission that were never solved (excluded from the buckets). */
  unsolvedCount: number;
};

export type TimelinePoint = { date: string; count: number };
export type ActivityHeatmap = {
  /** matrix[dayOfWeek 0=Sun..6=Sat][hour 0..23] = submission count. */
  matrix: number[][];
  /** Largest single-cell count, for the colour scale (0 when there is no activity). */
  max: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Local calendar parts of an instant in a timezone (deterministic given the zone). */
function localParts(ms: number, timeZone: string): { date: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    date: `${m.year}-${m.month}-${m.day}`,
    hour: Number(m.hour) % 24,
    weekday: WEEKDAY_INDEX[m.weekday ?? 'Sun'] ?? 0,
  };
}

/** Group submissions by participant+problem, each list sorted oldest-first. */
function byParticipantProblem(submissions: StatsSubmission[]): StatsSubmission[][] {
  const groups = new Map<string, StatsSubmission[]>();
  for (const s of submissions) {
    const key = spanKey(s.participantId, s.problemId);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  const out: StatsSubmission[][] = [];
  for (const list of groups.values()) {
    out.push([...list].sort((a, b) => a.submittedAt - b.submittedAt));
  }
  return out;
}

function emptyAttempts(): AttemptsToSolve {
  return {
    buckets: [
      { label: '1', count: 0 },
      { label: '2', count: 0 },
      { label: '3', count: 0 },
      { label: '4', count: 0 },
      { label: '5+', count: 0 },
    ],
    solvedCount: 0,
    unsolvedCount: 0,
  };
}

/**
 * Per problem, the distribution of how many submissions each participant needed before
 * their first correct one, bucketed 1..4 and 5+. Pairs that submitted but never solved the
 * problem are counted in `unsolvedCount`. Keyed by problem id.
 */
export function computeAttemptsToSolveByProblem(
  submissions: StatsSubmission[],
): Map<string, AttemptsToSolve> {
  const result = new Map<string, AttemptsToSolve>();
  for (const list of byParticipantProblem(submissions.filter(wasJudged))) {
    const problemId = list[0]!.problemId;
    let entry = result.get(problemId);
    if (!entry) {
      entry = emptyAttempts();
      result.set(problemId, entry);
    }
    const idx = list.findIndex((s) => s.correct);
    if (idx === -1) {
      entry.unsolvedCount += 1;
    } else {
      entry.solvedCount += 1;
      entry.buckets[Math.min(idx + 1, 5) - 1]!.count += 1;
    }
  }
  return result;
}

/**
 * Per problem: how many participants got it right on their very first submission, out of
 * those who submitted it at all. Keyed by problem id.
 */
export function computeFirstAttemptSuccess(
  submissions: StatsSubmission[],
): Map<string, { correct: number; submitted: number }> {
  const result = new Map<string, { correct: number; submitted: number }>();
  for (const list of byParticipantProblem(submissions.filter(wasJudged))) {
    const first = list[0];
    if (!first) continue;
    const rec = result.get(first.problemId) ?? { correct: 0, submitted: 0 };
    rec.submitted += 1;
    if (first.correct) rec.correct += 1;
    result.set(first.problemId, rec);
  }
  return result;
}

/**
 * Submissions per local calendar day (course timezone), with zero-filled gaps so the axis
 * is continuous. Empty when there are no submissions.
 */
export function computeSubmissionTimeline(
  submissions: StatsSubmission[],
  timeZone: string,
): TimelinePoint[] {
  if (submissions.length === 0) return [];
  const counts = new Map<string, number>();
  for (const s of submissions) {
    const { date } = localParts(s.submittedAt, timeZone);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const dates = [...counts.keys()].sort();
  const day = 86_400_000;
  const out: TimelinePoint[] = [];
  let cursor = new Date(`${dates[0]}T00:00:00Z`).getTime();
  const end = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime();
  while (cursor <= end) {
    const label = new Date(cursor).toISOString().slice(0, 10);
    out.push({ date: label, count: counts.get(label) ?? 0 });
    cursor += day;
  }
  return out;
}

/** 7x24 grid (day-of-week x hour, course timezone) of submission counts. */
export function computeActivityHeatmap(
  submissions: StatsSubmission[],
  timeZone: string,
): ActivityHeatmap {
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let max = 0;
  for (const s of submissions) {
    const { hour, weekday } = localParts(s.submittedAt, timeZone);
    const next = (matrix[weekday]![hour] ?? 0) + 1;
    matrix[weekday]![hour] = next;
    if (next > max) max = next;
  }
  return { matrix, max };
}

/** Discrete 0..4 intensity level for a heatmap cell. */
export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Map a cell count to a 0..4 intensity level on a square-root scale, so a single
 * deadline-driven spike doesn't flatten every other cell to "empty". 0 means no
 * submissions; 1..4 span low to highest activity relative to the busiest cell.
 */
export function heatmapLevel(count: number, max: number): HeatmapLevel {
  if (count <= 0 || max <= 0) return 0;
  const s = Math.sqrt(count / max);
  if (s <= 0.25) return 1;
  if (s <= 0.5) return 2;
  if (s <= 0.75) return 3;
  return 4;
}

/**
 * The running total of a timeline, day by day.
 *
 * Cumulative because a term is too long to read as bars: at fifteen weeks the daily counts
 * are a picket fence, while a running total turns the same data into a shape, where the
 * interesting thing is the slope. Flat means nobody is working; a riser means everybody is,
 * and where the riser STARTS relative to a deadline is the whole point of drawing it.
 */
export function runningTotals(
  timeline: TimelinePoint[],
): { date: string; count: number; total: number }[] {
  let total = 0;
  return timeline.map((point) => {
    total += point.count;
    return { date: point.date, count: point.count, total };
  });
}

/** When a participant first and last submitted a problem, epoch milliseconds. */
export type SubmissionSpan = { first: number; latest: number };

/**
 * How a participant and a problem are keyed together in the span map.
 *
 * Exported because the course page builds the same map from its own rows and asks the same
 * questions of it. A separator no id can contain, so "a" + "bc" and "ab" + "c" cannot collide.
 */
export function spanKey(participantId: string, problemId: string): string {
  return `${participantId}\u0000${problemId}`;
}

/** The span of each participant's attempts at each problem, keyed participant+problem. */
export function submissionSpans(submissions: StatsSubmission[]): Map<string, SubmissionSpan> {
  const spans = new Map<string, SubmissionSpan>();
  for (const s of submissions) {
    const key = spanKey(s.participantId, s.problemId);
    const held = spans.get(key);
    if (!held) {
      spans.set(key, { first: s.submittedAt, latest: s.submittedAt });
      continue;
    }
    if (s.submittedAt < held.first) held.first = s.submittedAt;
    if (s.submittedAt > held.latest) held.latest = s.submittedAt;
  }
  return spans;
}

/**
 * Where one participant stands with their deadline on one problem.
 *
 * The latest attempt decides, because it is the one that holds the grade. A participant
 * whose latest attempt is on time cannot have a late one, since it would be the latest.
 */
export function turnInStateOf(
  participant: StatsParticipant,
  problemId: string,
  spans: Map<string, SubmissionSpan>,
): TurnInStateKey {
  const span = spans.get(spanKey(participant.id, problemId));
  if (!span) return 'missing';
  if (span.latest <= participant.dueAt) return 'on-time';
  return span.first <= participant.dueAt ? 'revised-late' : 'late';
}

/**
 * Where one participant stands with the grader on one problem.
 *
 * A grade that predates the participant's newest submission is reported as needing another
 * look rather than as settled. That is the case a hand-grading queue loses: the work was
 * marked, the student sent more, and nothing on the page said so. Autograded problems
 * regrade themselves, so it is rare there and harmless when it appears.
 */
export function gradingStateOf(
  participant: StatsParticipant,
  problemId: string,
  spans: Map<string, SubmissionSpan>,
): GradingStateKey {
  const submittedAt = spans.get(spanKey(participant.id, problemId))?.latest;
  if (participant.problemGrades[problemId] === undefined) {
    return submittedAt === undefined ? 'ungraded-missing' : 'ungraded-submitted';
  }
  const gradedAt = participant.gradedAtByProblem[problemId];
  if (gradedAt === undefined || submittedAt === undefined) return 'graded';
  return submittedAt > gradedAt ? 'graded-stale' : 'graded';
}

// ─── assembly ────────────────────────────────────────────────────────────────

export type StatsProblem = {
  id: string;
  title: string;
  /** Position within the assignment; the box plots render in this order. */
  order: number;
  maxPoints: number;
  /**
   * Whether the autograder marks this problem.
   *
   * It decides how the two progress readings should be read, not what they contain: work
   * waiting for a grade is a moment on an autograded problem and a queue of marking on a
   * hand-graded one.
   */
  autograderEnabled: boolean;
};

export type StatsParticipant = {
  id: string;
  /** True when a due-date exception (override) applies to this participant. */
  hasException: boolean;
  /**
   * Recorded grade points per problem id. A key is present ONLY when that problem is graded
   * for this participant; a present value of 0 is a real zero and counts. Drives the score
   * charts (histogram, box plots), never the status chart.
   */
  problemGrades: Record<string, number>;
  /**
   * The due date this participant is actually held to, epoch milliseconds: their override if
   * they have one, the assignment's date otherwise. Timing is judged against this and never
   * against the class's date, so an extension reads as an extension.
   */
  dueAt: number;
  /**
   * When each recorded grade was last written, epoch milliseconds, keyed by problem id. The
   * keys mirror `problemGrades`. Compared against the latest submission so a grade that has
   * been overtaken by newer work can say so instead of reading as settled.
   */
  gradedAtByProblem: Record<string, number>;
  /**
   * The evaluation-queue state of the participant's LATEST submission per problem id. A key
   * is present only when a submission exists; a missing key means no submission (→ `missing`).
   */
  latestStatusByProblem: Record<string, SubmissionQueueStatus>;
};

/**
 * Somebody the assignment was not measured on, and why.
 *
 * Every exclusion is a judgement about who the figures describe, so the page states them
 * rather than quietly shrinking its denominator. Counts only: this is an aggregate surface
 * and names belong on the roster and submissions screens.
 */
export type CohortExclusion = {
  reason:
    /** Left the course. Their work is kept and stays reviewable elsewhere. */
    | 'dropped'
    /** The account is disabled, so nobody can do this work. */
    | 'inactive'
    /** Assigned, but in no group in this assignment's group set, so they cannot submit. */
    | 'no-group'
    /** A group whose members have all left, so nobody is left to do it. */
    | 'empty-group';
  count: number;
};

export type BuildStatisticsInput = {
  unit: 'student' | 'group';
  problems: StatsProblem[];
  participants: StatsParticipant[];
  /** Raw submission events (already filtered to assigned participants). */
  submissions: StatsSubmission[];
  /** Course timezone, for bucketing the timeline and activity heatmap by local time. */
  timeZone: string;
  /** Who the loader left out, and why. Reported as given; nothing here recomputes it. */
  exclusions?: CohortExclusion[];
};

export type ProblemStats = {
  id: string;
  title: string;
  order: number;
  boxplot: BoxPlotStats | null;
  gradedCount: number;
  ungradedCount: number;
  /** Whether the autograder marks this problem. False means a person does. */
  autograderEnabled: boolean;
  /**
   * What this problem is worth.
   *
   * The box plot below normalises every problem to 0-100% so they can be compared at all,
   * which also hides that one of them is worth eight times another. The weight has to travel
   * with the shape or the comparison misleads.
   */
  maxPoints: number;
  /**
   * Marks lost per graded participant, on average: the mean of (points possible - points
   * earned) over everybody who has a grade for this problem. Null when nobody does.
   *
   * The number a professor decides on. A problem everyone half-solved costs the class more
   * than one a few people failed, and neither the median nor the spread says which is which
   * until the points are in it. Not clamped: a grade above the maximum is a bonus somebody
   * awarded on purpose, and pretending it was zero loss would flatter the problem.
   */
  pointsLostMean: number | null;
  /** Submission-status breakdown for THIS problem, in fixed order; counts sum to
   *  participantCount (every assigned participant is expected to do every problem). */
  status: { key: StatusKey; count: number }[];
  /** Grading breakdown for THIS problem, in fixed order; counts sum to participantCount. */
  grading: { key: GradingStateKey; count: number }[];
  /** Turn-in breakdown for THIS problem, in fixed order; counts sum to participantCount. */
  turnIn: { key: TurnInStateKey; count: number }[];
  /** How many participants got this problem right on their first submission... */
  firstAttemptCorrect: number;
  /** ...out of how many submitted it at all. */
  firstAttemptSubmitted: number;
  /** Attempts-until-first-correct distribution for THIS problem (plus its unsolved count). */
  attempts: AttemptsToSolve;
};

export type AssignmentStatistics = {
  unit: 'student' | 'group';
  /** Total assigned participants: the denominator for status percentages. */
  participantCount: number;
  /** Participants with a due-date exception applied. */
  exceptionCount: number;
  /** Who was left out of `participantCount`, and why. Empty when nobody was. */
  exclusions: CohortExclusion[];
  histogram: ScoreDistribution;
  /**
   * The same distribution with work that was NEVER SUBMITTED counted as zero.
   *
   * A missing submission is not a zero until somebody decides it is: until the deadline
   * passes, until an extension is refused, until the professor says so. So the page keeps
   * both readings and lets them choose which they are looking at, rather than picking one
   * and calling it the class average.
   *
   * Work that was submitted and not yet marked is NOT zeroed here. It is waiting on a
   * grader, and reporting it as a zero would understate the class for as long as marking
   * takes.
   */
  histogramCountingMissingAsZero: ScoreDistribution;
  problems: ProblemStats[];
  timeline: TimelinePoint[];
  heatmap: ActivityHeatmap;
};

/** One reading of the class's scores: the bars, the middle, the spread, and who is missing. */
export type ScoreDistribution = {
  bins: HistogramBin[];
  includedCount: number;
  excludedCount: number;
  mean: number | null;
  median: number | null;
  /** Lowest and highest included percentage, for the summary line. Null when none. */
  low: number | null;
  high: number | null;
  /**
   * What the excluded participants are waiting on: problems they SUBMITTED and nobody has
   * marked, commonest first. "14 excluded" is a fact nobody can act on; "12 are waiting on
   * Problem 3" is the same fact with the next move in it.
   */
  waitingOn: { problemId: string; title: string; count: number }[];
  /**
   * Problems the excluded participants never submitted, commonest first.
   *
   * Kept apart from `waitingOn` because they are somebody else's job: one is a grader's
   * queue, the other is a student who has handed in nothing, and a page that says "waiting
   * on" about both sends the professor to mark work that does not exist.
   */
  notSubmitted: { problemId: string; title: string; count: number }[];
  /**
   * The assignment has no points to award, so no percentage exists for anybody. A
   * different sentence from "not graded yet", and a different thing to do about it.
   */
  noPossiblePoints: boolean;
};

/** Turn a per-problem tally into the named, commonest-first list the page reads out. */
function byProblem(
  counts: Map<string, number>,
  problems: StatsProblem[],
): { problemId: string; title: string; count: number }[] {
  return [...counts.entries()]
    .map(([problemId, count]) => ({
      problemId,
      title: problems.find((p) => p.id === problemId)?.title ?? '',
      count,
    }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
}

/**
 * One reading of the score distribution.
 *
 * `missingAsZero` decides what to do about a problem a participant has no grade for. Off, it
 * keeps them out of the chart entirely, because a partial score is not a score. On, a problem
 * they never submitted counts as zero, while one they submitted and nobody has marked still
 * keeps them out: that is a grader's queue, not a zero.
 */
export function buildScoreDistribution(
  problems: StatsProblem[],
  participants: StatsParticipant[],
  spans: Map<string, SubmissionSpan>,
  options: { missingAsZero: boolean } = { missingAsZero: false },
): ScoreDistribution {
  const totalPossible = problems.reduce((sum, p) => sum + p.maxPoints, 0);
  const percentages: number[] = [];
  let excludedCount = 0;
  const waiting = new Map<string, number>();
  const absent = new Map<string, number>();

  for (const part of participants) {
    const ungraded = problems.filter((p) => part.problemGrades[p.id] === undefined);
    // Ungraded work that cannot be scored yet: everything with no grade, minus the pieces
    // this reading is willing to call a zero.
    const blocking = options.missingAsZero
      ? ungraded.filter((p) => spans.has(spanKey(part.id, p.id)))
      : ungraded;

    if (problems.length === 0 || blocking.length > 0 || totalPossible <= 0) {
      excludedCount += 1;
      // Only when there are points to score: on a zero-point assignment nobody is waiting
      // on grading, the assignment simply has no percentage to report.
      if (totalPossible > 0) {
        for (const p of blocking) {
          const tally = spans.has(spanKey(part.id, p.id)) ? waiting : absent;
          tally.set(p.id, (tally.get(p.id) ?? 0) + 1);
        }
      }
      continue;
    }

    const earned = problems.reduce((sum, p) => sum + (part.problemGrades[p.id] ?? 0), 0);
    const pct = assignmentPercentage(earned, totalPossible);
    if (pct == null) excludedCount += 1;
    else percentages.push(pct);
  }

  const histogram = computeScoreHistogram(percentages);
  return {
    bins: histogram.bins,
    includedCount: percentages.length,
    excludedCount,
    mean: histogram.mean,
    median: histogram.median,
    low: percentages.length > 0 ? Math.min(...percentages) : null,
    high: percentages.length > 0 ? Math.max(...percentages) : null,
    waitingOn: byProblem(waiting, problems),
    notSubmitted: byProblem(absent, problems),
    noPossiblePoints: totalPossible <= 0,
  };
}

/**
 * Turn already-loaded, database-agnostic participant facts into the full analytics
 * payload. This is the single place the three charts' numbers are decided, so the API and
 * any test see identical results.
 */
export function buildAssignmentStatistics(input: BuildStatisticsInput): AssignmentStatistics {
  const { problems, participants, unit, submissions, timeZone } = input;
  const firstAttempt = computeFirstAttemptSuccess(submissions);
  const attemptsByProblem = computeAttemptsToSolveByProblem(submissions);
  const spans = submissionSpans(submissions);

  // Two readings of the same scores: only fully graded work, and the same with work nobody
  // submitted counted as zero. Which one is the class average is the professor's call, so
  // the page carries both and says which it is showing.
  const histogram = buildScoreDistribution(problems, participants, spans);
  const histogramCountingMissingAsZero = buildScoreDistribution(problems, participants, spans, {
    missingAsZero: true,
  });

  // One entry per problem: its score box plot AND its own submission-status breakdown
  // (the queue state of each participant's latest submission for that problem, else
  // "missing"), rendered in assignment order.
  const problemStats: ProblemStats[] = [...problems]
    .sort((a, b) => a.order - b.order)
    .map((p) => {
      const values: number[] = [];
      const lost: number[] = [];
      let gradedCount = 0;
      const statusCounts = new Map<StatusKey, number>(STATUS_ORDER.map((k) => [k, 0]));
      const gradingCounts = new Map<GradingStateKey, number>(GRADING_ORDER.map((k) => [k, 0]));
      const turnInCounts = new Map<TurnInStateKey, number>(TURN_IN_ORDER.map((k) => [k, 0]));
      for (const part of participants) {
        const key = queueStatusKey(part.latestStatusByProblem[p.id]);
        statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);

        const gradingKey = gradingStateOf(part, p.id, spans);
        gradingCounts.set(gradingKey, (gradingCounts.get(gradingKey) ?? 0) + 1);

        const turnInKey = turnInStateOf(part, p.id, spans);
        turnInCounts.set(turnInKey, (turnInCounts.get(turnInKey) ?? 0) + 1);

        const grade = part.problemGrades[p.id];
        if (grade === undefined) continue;
        gradedCount += 1;
        // A problem worth zero points has no meaningful normalized score; it still counts
        // as graded but contributes no distribution point, and nothing can be lost on it.
        if (p.maxPoints > 0) {
          values.push((grade / p.maxPoints) * 100);
          lost.push(p.maxPoints - grade);
        }
      }
      const fa = firstAttempt.get(p.id) ?? { correct: 0, submitted: 0 };
      return {
        id: p.id,
        title: p.title,
        order: p.order,
        autograderEnabled: p.autograderEnabled,
        maxPoints: p.maxPoints,
        pointsLostMean: meanOf(lost),
        boxplot: computeBoxPlot(values),
        gradedCount,
        ungradedCount: participants.length - gradedCount,
        status: STATUS_ORDER.map((key) => ({ key, count: statusCounts.get(key) ?? 0 })),
        grading: GRADING_ORDER.map((key) => ({ key, count: gradingCounts.get(key) ?? 0 })),
        turnIn: TURN_IN_ORDER.map((key) => ({ key, count: turnInCounts.get(key) ?? 0 })),
        firstAttemptCorrect: fa.correct,
        firstAttemptSubmitted: fa.submitted,
        attempts: attemptsByProblem.get(p.id) ?? emptyAttempts(),
      };
    });

  return {
    unit,
    participantCount: participants.length,
    exceptionCount: participants.filter((p) => p.hasException).length,
    exclusions: (input.exclusions ?? []).filter((e) => e.count > 0),
    histogram,
    histogramCountingMissingAsZero,
    problems: problemStats,
    timeline: computeSubmissionTimeline(submissions, timeZone),
    heatmap: computeActivityHeatmap(submissions, timeZone),
  };
}
