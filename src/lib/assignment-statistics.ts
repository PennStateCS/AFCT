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
 *   - STATUS (segmented bar): driven by submission behaviour against the participant's
 *     effective due date. Grades never affect status; submissions never affect the score.
 *
 * "Participant" is a student for an individual assignment and a group for a group
 * assignment; the caller fixes the unit and never mixes the two in one result.
 */

export type StatusKey = 'on-time' | 'late' | 'in-progress' | 'missing' | 'not-started';

/** Fixed display + legend order for the status bar (best outcome first). */
export const STATUS_ORDER: readonly StatusKey[] = [
  'on-time',
  'late',
  'in-progress',
  'missing',
  'not-started',
] as const;

/** Plain-language labels, kept here (not in the component) so tests can assert them. */
export const STATUS_LABELS: Record<StatusKey, string> = {
  'on-time': 'On time',
  late: 'Late',
  'in-progress': 'In progress',
  missing: 'Missing',
  'not-started': 'Not started',
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

// ─── status classification ───────────────────────────────────────────────────

export type ParticipantStatusFacts = {
  /** Problems on the assignment (the completion denominator). */
  requiredProblemCount: number;
  /** Problems the participant has completed (see `buildAssignmentStatistics` for the rule). */
  completedProblemCount: number;
  /** Any engagement at all: a submission OR a recorded grade (e.g. a manual entry). */
  hasActivity: boolean;
  /**
   * When the participant finished: the latest correct submission across all problems. Only
   * meaningful when complete; null when there is no timing evidence (e.g. the work was only
   * ever manually graded, with no submission).
   */
  latestCompletionAt: Date | null;
  /** The participant's effective due date (base date with any exception already applied). */
  effectiveDue: Date;
};

/**
 * Classify one participant into a mutually exclusive submission status. The boundary is
 * deliberate: a submission exactly at the effective due date is on time (strict `>` for
 * late), and a future extended deadline keeps an unfinished participant in
 * not-started/in-progress rather than missing.
 */
export function classifyParticipantStatus(facts: ParticipantStatusFacts, now: Date): StatusKey {
  const complete =
    facts.requiredProblemCount > 0 && facts.completedProblemCount >= facts.requiredProblemCount;
  const pastDue = now.getTime() > facts.effectiveDue.getTime();

  if (complete) {
    const finishedLate =
      facts.latestCompletionAt != null &&
      facts.latestCompletionAt.getTime() > facts.effectiveDue.getTime();
    return finishedLate ? 'late' : 'on-time';
  }

  if (!facts.hasActivity) return pastDue ? 'missing' : 'not-started';
  return pastDue ? 'missing' : 'in-progress';
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
  /** Resolved effective due date (base + any student/group exception). */
  effectiveDue: Date;
  /** True when a due-date exception (override) applies to this participant. */
  hasException: boolean;
  /**
   * Recorded grade points per problem id. A key is present ONLY when that problem is graded
   * for this participant; a present value of 0 is a real zero and counts. This is
   * authoritative for completion: a grade (e.g. a manual entry) overrides the submission
   * signal, so a manually full-marked problem counts as complete even with no submission,
   * and a manually zeroed one does not, even with a correct submission.
   */
  problemGrades: Record<string, number>;
  /** Latest correct-submission instant per problem id; present ONLY when a correct
   *  submission exists for that problem. Completion fallback for problems with no grade
   *  row, and the source of per-problem completion timing. */
  correctAtByProblem: Record<string, Date>;
  /** Problem ids the participant has any submission for (correct or not). */
  submittedProblemIds: string[];
};

/**
 * Whether a participant has completed one problem. Grade-authoritative: when a grade row
 * exists it decides (full marks = complete), so a manual grade overrides the autograder in
 * both directions. Only when a problem has no grade at all do we fall back to "a correct
 * submission exists" (covers non-autograded work graded later, or a lagging grade write).
 */
function problemCompleted(problem: StatsProblem, participant: StatsParticipant): boolean {
  const grade = participant.problemGrades[problem.id];
  if (grade !== undefined) return problem.maxPoints > 0 ? grade >= problem.maxPoints : true;
  return participant.correctAtByProblem[problem.id] !== undefined;
}

/**
 * One participant's submission status on ONE problem: the same rules as the assignment-level
 * classifier, scoped to a single problem (its own grade, its own correct-submission time,
 * and whether it has any submission), measured against the participant's effective due date.
 */
function problemStatus(problem: StatsProblem, participant: StatsParticipant, now: Date): StatusKey {
  const grade = participant.problemGrades[problem.id];
  return classifyParticipantStatus(
    {
      requiredProblemCount: 1,
      completedProblemCount: problemCompleted(problem, participant) ? 1 : 0,
      // A grade (e.g. a manual entry) is engagement even with no submission.
      hasActivity: participant.submittedProblemIds.includes(problem.id) || grade !== undefined,
      latestCompletionAt: participant.correctAtByProblem[problem.id] ?? null,
      effectiveDue: participant.effectiveDue,
    },
    now,
  );
}

export type BuildStatisticsInput = {
  unit: 'student' | 'group';
  problems: StatsProblem[];
  participants: StatsParticipant[];
  /** Injected for deterministic tests; the service passes the request time. */
  now: Date;
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
};

/**
 * Turn already-loaded, database-agnostic participant facts into the full analytics
 * payload. This is the single place the three charts' numbers are decided, so the API and
 * any test see identical results.
 */
export function buildAssignmentStatistics(input: BuildStatisticsInput): AssignmentStatistics {
  const { problems, participants, unit, now } = input;
  const requiredProblemCount = problems.length;
  const totalPossible = problems.reduce((sum, p) => sum + p.maxPoints, 0);

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
  // (measured per problem, not per assignment), rendered in assignment order.
  const problemStats: ProblemStats[] = [...problems]
    .sort((a, b) => a.order - b.order)
    .map((p) => {
      const values: number[] = [];
      let gradedCount = 0;
      const statusCounts = new Map<StatusKey, number>(STATUS_ORDER.map((k) => [k, 0]));
      for (const part of participants) {
        const key = problemStatus(p, part, now);
        statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);

        const grade = part.problemGrades[p.id];
        if (grade === undefined) continue;
        gradedCount += 1;
        // A problem worth zero points has no meaningful normalized score; it still counts
        // as graded but contributes no distribution point.
        if (p.maxPoints > 0) values.push((grade / p.maxPoints) * 100);
      }
      return {
        id: p.id,
        title: p.title,
        order: p.order,
        boxplot: computeBoxPlot(values),
        gradedCount,
        ungradedCount: participants.length - gradedCount,
        status: STATUS_ORDER.map((key) => ({ key, count: statusCounts.get(key) ?? 0 })),
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
  };
}
