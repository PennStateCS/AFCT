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
};

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
    const key = `${s.participantId} ${s.problemId}`;
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

/**
 * Distribution of how many submissions each participant needed before their first correct
 * one, bucketed 1..4 and 5+. Only pairs that were eventually solved are counted; pairs that
 * submitted but never got it right are reported separately (unsolvedCount).
 */
export function computeAttemptsToSolve(submissions: StatsSubmission[]): AttemptsToSolve {
  const buckets: AttemptsBucket[] = [
    { label: '1', count: 0 },
    { label: '2', count: 0 },
    { label: '3', count: 0 },
    { label: '4', count: 0 },
    { label: '5+', count: 0 },
  ];
  let solvedCount = 0;
  let unsolvedCount = 0;
  for (const list of byParticipantProblem(submissions)) {
    const idx = list.findIndex((s) => s.correct);
    if (idx === -1) {
      unsolvedCount += 1;
      continue;
    }
    solvedCount += 1;
    const attempts = idx + 1;
    buckets[Math.min(attempts, 5) - 1]!.count += 1;
  }
  return { buckets, solvedCount, unsolvedCount };
}

/**
 * Per problem: how many participants got it right on their very first submission, out of
 * those who submitted it at all. Keyed by problem id.
 */
export function computeFirstAttemptSuccess(
  submissions: StatsSubmission[],
): Map<string, { correct: number; submitted: number }> {
  const result = new Map<string, { correct: number; submitted: number }>();
  for (const list of byParticipantProblem(submissions)) {
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

// ─── assembly ────────────────────────────────────────────────────────────────

export type StatsProblem = {
  id: string;
  title: string;
  /** Position within the assignment; the box plots render in this order. */
  order: number;
  maxPoints: number;
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
   * The evaluation-queue state of the participant's LATEST submission per problem id. A key
   * is present only when a submission exists; a missing key means no submission (→ `missing`).
   */
  latestStatusByProblem: Record<string, SubmissionQueueStatus>;
};

export type BuildStatisticsInput = {
  unit: 'student' | 'group';
  problems: StatsProblem[];
  participants: StatsParticipant[];
  /** Raw submission events (already filtered to assigned participants). */
  submissions: StatsSubmission[];
  /** Course timezone, for bucketing the timeline and activity heatmap by local time. */
  timeZone: string;
};

export type ProblemStats = {
  id: string;
  title: string;
  order: number;
  boxplot: BoxPlotStats | null;
  gradedCount: number;
  ungradedCount: number;
  /** Submission-status breakdown for THIS problem, in fixed order; counts sum to
   *  participantCount (every assigned participant is expected to do every problem). */
  status: { key: StatusKey; count: number }[];
  /** How many participants got this problem right on their first submission... */
  firstAttemptCorrect: number;
  /** ...out of how many submitted it at all. */
  firstAttemptSubmitted: number;
};

export type AssignmentStatistics = {
  unit: 'student' | 'group';
  /** Total assigned participants: the denominator for status percentages. */
  participantCount: number;
  /** Participants with a due-date exception applied. */
  exceptionCount: number;
  histogram: {
    bins: HistogramBin[];
    includedCount: number;
    excludedCount: number;
    mean: number | null;
    median: number | null;
  };
  problems: ProblemStats[];
  attemptsToSolve: AttemptsToSolve;
  timeline: TimelinePoint[];
  heatmap: ActivityHeatmap;
};

/**
 * Turn already-loaded, database-agnostic participant facts into the full analytics
 * payload. This is the single place the three charts' numbers are decided, so the API and
 * any test see identical results.
 */
export function buildAssignmentStatistics(input: BuildStatisticsInput): AssignmentStatistics {
  const { problems, participants, unit, submissions, timeZone } = input;
  const requiredProblemCount = problems.length;
  const totalPossible = problems.reduce((sum, p) => sum + p.maxPoints, 0);
  const firstAttempt = computeFirstAttemptSuccess(submissions);

  // Histogram: include a participant only when EVERY problem is graded for them, so
  // partially graded work never pollutes the distribution. Everyone else is excluded and
  // counted so the UI can state how many were left out.
  const includedPercentages: number[] = [];
  let excludedCount = 0;
  for (const part of participants) {
    const fullyGraded =
      requiredProblemCount > 0 && problems.every((p) => part.problemGrades[p.id] !== undefined);
    if (!fullyGraded || totalPossible <= 0) {
      excludedCount += 1;
      continue;
    }
    const earned = problems.reduce((sum, p) => sum + (part.problemGrades[p.id] ?? 0), 0);
    const pct = assignmentPercentage(earned, totalPossible);
    if (pct == null) {
      excludedCount += 1;
    } else {
      includedPercentages.push(pct);
    }
  }
  const histogram = computeScoreHistogram(includedPercentages);

  // One entry per problem: its score box plot AND its own submission-status breakdown
  // (the queue state of each participant's latest submission for that problem, else
  // "missing"), rendered in assignment order.
  const problemStats: ProblemStats[] = [...problems]
    .sort((a, b) => a.order - b.order)
    .map((p) => {
      const values: number[] = [];
      let gradedCount = 0;
      const statusCounts = new Map<StatusKey, number>(STATUS_ORDER.map((k) => [k, 0]));
      for (const part of participants) {
        const key = queueStatusKey(part.latestStatusByProblem[p.id]);
        statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);

        const grade = part.problemGrades[p.id];
        if (grade === undefined) continue;
        gradedCount += 1;
        // A problem worth zero points has no meaningful normalized score; it still counts
        // as graded but contributes no distribution point.
        if (p.maxPoints > 0) values.push((grade / p.maxPoints) * 100);
      }
      const fa = firstAttempt.get(p.id) ?? { correct: 0, submitted: 0 };
      return {
        id: p.id,
        title: p.title,
        order: p.order,
        boxplot: computeBoxPlot(values),
        gradedCount,
        ungradedCount: participants.length - gradedCount,
        status: STATUS_ORDER.map((key) => ({ key, count: statusCounts.get(key) ?? 0 })),
        firstAttemptCorrect: fa.correct,
        firstAttemptSubmitted: fa.submitted,
      };
    });

  return {
    unit,
    participantCount: participants.length,
    exceptionCount: participants.filter((p) => p.hasException).length,
    histogram: {
      bins: histogram.bins,
      includedCount: includedPercentages.length,
      excludedCount,
      mean: histogram.mean,
      median: histogram.median,
    },
    problems: problemStats,
    attemptsToSolve: computeAttemptsToSolve(submissions),
    timeline: computeSubmissionTimeline(submissions, timeZone),
    heatmap: computeActivityHeatmap(submissions, timeZone),
  };
}
