/**
 * Pure, database-free statistics for a course's analytics page (the course Statistics tab).
 *
 * The sibling of `assignment-statistics.ts`, and deliberately built the same way: the loader
 * shapes rows, this decides every number, and the components only draw. Anything both pages
 * say is imported from there rather than restated here, so a student described on one page is
 * described in the same words on the other.
 *
 * What this page can say that the assignment page cannot is comparison: which assignment was
 * the hard one, which KIND of problem this class struggles with, and where the course as a
 * whole stands. What it deliberately cannot say is anything about one problem inside one
 * assignment. That is a click away and it is the other page's job.
 */

import {
  computeAttemptsToSolveByProblem,
  computeBoxPlot,
  computeFirstAttemptSuccess,
  computeScoreHistogram,
  meanOf,
  TURN_IN_ORDER,
  type BoxPlotStats,
  type GradingStateKey,
  type AttemptsToSolve,
  type HistogramBin,
  type StatsSubmission,
  type TurnInStateKey,
} from '@/lib/assignment-statistics';

/** The five kinds of work a theory course sets, plus the ones nobody has typed. */
export type ProblemTypeKey = 'FA' | 'RE' | 'CFG' | 'PDA' | 'TM' | 'untyped';

/** Reading order: roughly the order a course meets them, with the untyped bucket last. */
export const PROBLEM_TYPE_ORDER: readonly ProblemTypeKey[] = [
  'FA',
  'RE',
  'CFG',
  'PDA',
  'TM',
  'untyped',
] as const;

export const PROBLEM_TYPE_LABELS: Record<ProblemTypeKey, string> = {
  FA: 'Finite automata',
  RE: 'Regular expressions',
  CFG: 'Context-free grammars',
  PDA: 'Pushdown automata',
  TM: 'Turing machines',
  untyped: 'No type set',
};

/** `Problem.type` is nullable, and an untyped problem is still work somebody did. */
export function problemTypeKey(type: string | null | undefined): ProblemTypeKey {
  return type === 'FA' || type === 'RE' || type === 'CFG' || type === 'PDA' || type === 'TM'
    ? type
    : 'untyped';
}

/**
 * One person's standing in one assignment, as the loader hands it over.
 *
 * `earned` is null when nothing is recorded. `possible` is what the assignment is worth to
 * this participant. The pair is kept rather than a percentage so the two readings of the
 * course average can be computed from the same rows.
 */
export type CourseGradeCell = {
  participantId: string;
  assignmentId: string;
  earned: number | null;
  possible: number;
};

/** An assignment as this page compares them. */
export type CourseAssignment = {
  id: string;
  title: string;
  /** Due date as epoch milliseconds. The comparison card reads in this order. */
  dueAt: number;
  maxPoints: number;
  /** Whether students can see it. Unpublished work is nobody's fault: see `courseAverages`. */
  isPublished: boolean;
  /** What one row of the comparison counts: teams on a group assignment, people otherwise. */
  unit: 'student' | 'group';
  /** How many participants it was set for, in that unit. */
  participantCount: number;
};

/** One graded piece of work, as the problem-type card counts them. */
export type TypedGrade = {
  type: ProblemTypeKey;
  /** Points earned over points possible, already checked for a zero-point problem. */
  percent: number;
  /** True when the problem is graded for this participant. */
  graded: boolean;
};

export type CourseDistribution = {
  bins: HistogramBin[];
  includedCount: number;
  mean: number | null;
  median: number | null;
  low: number | null;
  high: number | null;
  /** How many assignments the denominator counted, and how many are graded for anybody. */
  assignmentsCounted: number;
  assignmentsWithGrades: number;
};

/**
 * The two readings of a course average, from one set of cells.
 *
 * `everythingAssigned` is the gradebook's rule (`averagePct` in `course-grades.ts`): every
 * assignment a participant is assigned puts its full points in the denominator, and only
 * recorded grades add to the numerator, so ungraded work reads as unearned. The Grades tab
 * shows exactly this number, and the two must agree.
 *
 * `gradedOnly` counts an assignment only once it is graded for that participant. Mid-term it
 * is the kinder and more accurate reading of how the class is doing; at the end of term it is
 * the one that lets somebody who has stopped submitting look fine.
 *
 * Both skip assignments nobody can see. An unpublished draft is not work a student failed to
 * do, and counting it against them is the difference between "your class is at 45%" and the
 * truth. (The gradebook itself does count them, which is a wart there rather than a rule to
 * copy.)
 */
export function courseAverages(
  assignments: CourseAssignment[],
  cells: CourseGradeCell[],
): { everythingAssigned: CourseDistribution; gradedOnly: CourseDistribution } {
  const published = new Set(assignments.filter((a) => a.isPublished).map((a) => a.id));
  const byParticipant = new Map<string, CourseGradeCell[]>();
  for (const cell of cells) {
    if (!published.has(cell.assignmentId)) continue;
    byParticipant.set(cell.participantId, [...(byParticipant.get(cell.participantId) ?? []), cell]);
  }

  const everything: number[] = [];
  const graded: number[] = [];
  for (const list of byParticipant.values()) {
    const all = totalPercent(list, { gradedOnly: false });
    if (all !== null) everything.push(all);
    const some = totalPercent(list, { gradedOnly: true });
    if (some !== null) graded.push(some);
  }

  const assignmentsCounted = assignments.filter((a) => a.isPublished).length;
  const assignmentsWithGrades = new Set(
    cells
      .filter((c) => c.earned !== null && published.has(c.assignmentId))
      .map((c) => c.assignmentId),
  ).size;

  return {
    everythingAssigned: distributionOf(everything, assignmentsCounted, assignmentsWithGrades),
    gradedOnly: distributionOf(graded, assignmentsCounted, assignmentsWithGrades),
  };
}

/** One participant's percentage under one reading, or null when there is nothing to say. */
function totalPercent(cells: CourseGradeCell[], options: { gradedOnly: boolean }): number | null {
  let earned = 0;
  let possible = 0;
  let gradeCount = 0;
  for (const cell of cells) {
    if (options.gradedOnly && cell.earned === null) continue;
    possible += cell.possible;
    if (cell.earned !== null) {
      earned += cell.earned;
      gradeCount += 1;
    }
  }
  // Nothing graded is not a zero, under either reading: it is a course that has not started
  // marking. The same rule the assignment page applies to a single participant.
  if (gradeCount === 0 || possible <= 0) return null;
  return (earned / possible) * 100;
}

function distributionOf(
  percentages: number[],
  assignmentsCounted: number,
  assignmentsWithGrades: number,
): CourseDistribution {
  const histogram = computeScoreHistogram(percentages);
  return {
    bins: histogram.bins,
    includedCount: percentages.length,
    mean: histogram.mean,
    median: histogram.median,
    low: percentages.length > 0 ? Math.min(...percentages) : null,
    high: percentages.length > 0 ? Math.max(...percentages) : null,
    assignmentsCounted,
    assignmentsWithGrades,
  };
}

/** One row of the assignment comparison. */
export type AssignmentComparison = {
  id: string;
  title: string;
  dueAt: number;
  maxPoints: number;
  unit: 'student' | 'group';
  /** The score distribution across whoever is graded, on the shared 0-100% scale. */
  boxplot: BoxPlotStats | null;
  gradedCount: number;
  participantCount: number;
  /** Marks lost per graded participant, on average. Null when nobody is graded. */
  pointsLostMean: number | null;
};

/**
 * Each assignment's spread, in the unit that assignment was set in.
 *
 * The unit is per row on purpose. A group assignment is two teams, not eight students, and
 * flattening it into students would let one team of four outweigh a team of one in a
 * comparison that looks like it is about difficulty.
 */
export function compareAssignments(
  assignments: CourseAssignment[],
  cells: CourseGradeCell[],
): AssignmentComparison[] {
  const byAssignment = new Map<string, CourseGradeCell[]>();
  for (const cell of cells) {
    byAssignment.set(cell.assignmentId, [...(byAssignment.get(cell.assignmentId) ?? []), cell]);
  }

  return [...assignments]
    .sort((a, b) => a.dueAt - b.dueAt || a.title.localeCompare(b.title))
    .map((assignment) => {
      const graded = (byAssignment.get(assignment.id) ?? []).filter((c) => c.earned !== null);
      const percentages: number[] = [];
      const lost: number[] = [];
      for (const cell of graded) {
        if (cell.possible <= 0) continue;
        percentages.push((cell.earned! / cell.possible) * 100);
        lost.push(cell.possible - cell.earned!);
      }
      return {
        id: assignment.id,
        title: assignment.title,
        dueAt: assignment.dueAt,
        maxPoints: assignment.maxPoints,
        unit: assignment.unit,
        boxplot: computeBoxPlot(percentages),
        gradedCount: graded.length,
        participantCount: assignment.participantCount,
        pointsLostMean: meanOf(lost),
      };
    });
}

/** One row of the problem-type card. */
export type TypePerformance = {
  type: ProblemTypeKey;
  title: string;
  boxplot: BoxPlotStats | null;
  /** Graded pieces of work of this kind, and how many exist at all. */
  gradedCount: number;
  totalCount: number;
};

/**
 * How the class does on each kind of problem.
 *
 * The card only AFCT can draw: a theory course is a sequence of topics, and this is the one
 * view that says which topic did not land. Two honesty requirements come with it. A problem
 * set on two assignments is counted twice, once per occasion, because meeting a topic again
 * on a midterm is a second performance and merging them would report neither. And each row
 * carries how much of it is graded, because mid-term the difference between an autograded row
 * and a hand-marked one is partly grading progress rather than difficulty.
 */
export function compareProblemTypes(grades: TypedGrade[]): TypePerformance[] {
  const byType = new Map<ProblemTypeKey, { values: number[]; total: number }>();
  for (const grade of grades) {
    const entry = byType.get(grade.type) ?? { values: [], total: 0 };
    entry.total += 1;
    if (grade.graded) entry.values.push(grade.percent);
    byType.set(grade.type, entry);
  }

  return PROBLEM_TYPE_ORDER.filter((type) => (byType.get(type)?.total ?? 0) > 0).map((type) => {
    const entry = byType.get(type)!;
    return {
      type,
      title: PROBLEM_TYPE_LABELS[type],
      boxplot: computeBoxPlot(entry.values),
      gradedCount: entry.values.length,
      totalCount: entry.total,
    };
  });
}

/** How many tries a kind of problem takes. */
export type AttemptsByType = {
  type: ProblemTypeKey;
  title: string;
  attempts: AttemptsToSolve;
  /** Got it right first time, out of those who submitted it at all. */
  firstTry: { correct: number; submitted: number };
};

/**
 * How many attempts each kind of problem takes before it comes right.
 *
 * The score cards say how well the class did on a topic; this says how hard they had to work
 * to get there, which is a different fact and sometimes the more useful one: a topic
 * everybody eventually solves on the fifth attempt is not a topic anybody has understood.
 *
 * The caller keys each series by the OCCASION, not the problem: a participant meeting the
 * same problem again on a midterm is starting over, and merging the two would report a run of
 * attempts nobody actually made. Failed evaluations are already excluded by the shared
 * attempt rule, because a run of ours that produced no verdict is not a try of theirs.
 */
export function attemptsByProblemType(submissions: StatsSubmission[]): AttemptsByType[] {
  const attempts = computeAttemptsToSolveByProblem(submissions);
  const firstAttempt = computeFirstAttemptSuccess(submissions);

  return PROBLEM_TYPE_ORDER.filter((type) => attempts.has(type)).map((type) => ({
    type,
    title: PROBLEM_TYPE_LABELS[type],
    attempts: attempts.get(type)!,
    firstTry: firstAttempt.get(type) ?? { correct: 0, submitted: 0 },
  }));
}

/** Whether each assignment came in on time, per assignment. */
export type TurnInByAssignment = {
  assignmentId: string;
  title: string;
  dueAt: number;
  unit: 'student' | 'group';
  states: { key: TurnInStateKey; count: number }[];
  total: number;
  /** Participants held to a date of their own on this assignment. */
  exceptions: number;
};

/** One participant's relationship with one assignment's deadline. */
export type TurnInInput = {
  assignmentId: string;
  participantId: string;
  /** The date THIS participant is held to, epoch milliseconds. */
  dueAt: number;
  /** True when that date is not the assignment's own. */
  hasException: boolean;
  /** When they first and last submitted anything for this assignment. Absent if never. */
  span?: { first: number; latest: number };
};

/**
 * Whether the work came in on time, assignment by assignment.
 *
 * The rule is the assignment page's, one level up. There, timing is judged per problem on
 * the attempt that holds the grade; across a whole assignment that is the same statement as
 * "the last thing they submitted for it", because the latest submission over the assignment
 * is the latest of the per-problem latests. So no new rule was invented for this card, which
 * is the point: a professor comparing the two pages sees the same student called the same
 * thing.
 *
 * Everyone is measured against their own date, so an extension reads as an extension rather
 * than as a black mark, and the card says how many people are on a different date.
 */
export function turnInByAssignment(
  assignments: CourseAssignment[],
  inputs: TurnInInput[],
): TurnInByAssignment[] {
  const byAssignment = new Map<string, TurnInInput[]>();
  for (const input of inputs) {
    byAssignment.set(input.assignmentId, [...(byAssignment.get(input.assignmentId) ?? []), input]);
  }

  return [...assignments]
    .sort((a, b) => a.dueAt - b.dueAt || a.title.localeCompare(b.title))
    .map((assignment) => {
      const rows = byAssignment.get(assignment.id) ?? [];
      const counts = new Map<TurnInStateKey, number>(TURN_IN_ORDER.map((key) => [key, 0]));
      for (const row of rows) {
        const key = turnInStateFor(row);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return {
        assignmentId: assignment.id,
        title: assignment.title,
        dueAt: assignment.dueAt,
        unit: assignment.unit,
        states: TURN_IN_ORDER.map((key) => ({ key, count: counts.get(key) ?? 0 })),
        total: rows.length,
        exceptions: rows.filter((row) => row.hasException).length,
      };
    });
}

/** The four states, from one participant's span against their own deadline. */
function turnInStateFor(input: TurnInInput): TurnInStateKey {
  if (!input.span) return 'missing';
  if (input.span.latest <= input.dueAt) return 'on-time';
  return input.span.first <= input.dueAt ? 'revised-late' : 'late';
}

/** What is waiting on a grader, per assignment. */
export type GradingWorkload = {
  assignmentId: string;
  title: string;
  dueAt: number;
  /** Counted in PIECES OF WORK: one participant's one problem. That is what a grader works
   *  through, and "3 awaiting grading" meaning three students hides four problems each. */
  states: { key: GradingStateKey; count: number }[];
  total: number;
};

/** How many students are worth a second look, and why. Counts only: names are the gradebook's. */
export type AtRisk = {
  /** Below the threshold on the reading the page is showing. */
  belowThreshold: number;
  threshold: number;
  /** Assigned, published work with nothing recorded and nothing submitted. */
  missingTwoOrMore: number;
};

/**
 * How many participants are below a line, and how many have stopped handing work in.
 *
 * Two different worries: a student who is trying and failing, and a student who has gone
 * quiet. The second is the one a professor can still do something about, which is why it is
 * counted separately rather than folded into an average.
 */
export function atRisk(
  assignments: CourseAssignment[],
  cells: CourseGradeCell[],
  percentages: Map<string, number>,
  threshold: number,
): AtRisk {
  const published = new Set(assignments.filter((a) => a.isPublished).map((a) => a.id));
  const missingByParticipant = new Map<string, number>();
  for (const cell of cells) {
    if (!published.has(cell.assignmentId) || cell.earned !== null) continue;
    missingByParticipant.set(
      cell.participantId,
      (missingByParticipant.get(cell.participantId) ?? 0) + 1,
    );
  }

  return {
    belowThreshold: [...percentages.values()].filter((pct) => pct < threshold).length,
    threshold,
    missingTwoOrMore: [...missingByParticipant.values()].filter((n) => n >= 2).length,
  };
}
