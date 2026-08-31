/**
 * Deciding which grades still need to reach the LMS.
 *
 * Derived by comparing each student's current grade against what was last queued, rather than
 * hooking every place a grade is written. Grades are written from several routes and the worker,
 * and a hook missing from one of them would lose marks silently. This way a grade changed while
 * the LMS was down is picked up on the next pass, with nothing to remember to call.
 */

import { prisma } from '@/lib/prisma';
import { queueScore, scoreQueueSummary, studentScoreState } from '@/lib/lti/score-queue';
import { studentsWithDerivedZeros } from '@/lib/course-grades';

/** Whether this course opens from any LMS. Nothing here does anything if it does not. */
export async function courseIsLinked(courseId: string): Promise<boolean> {
  return (await prisma.ltiContextLink.count({ where: { courseId } })) > 0;
}

/**
 * Queue every grade whose current value differs from what is already queued or sent.
 *
 * Returns how many were queued, which is what the "send grades now" button reports.
 */
export async function queueChangedGrades(
  assignmentId: string,
  opts: { retryFailed?: boolean; userId?: string } = {},
): Promise<number> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      courseId: true,
      missingWorkIsZero: true,
      problems: { select: { maxPoints: true } },
    },
  });
  if (!assignment) return 0;
  if (!(await courseIsLinked(assignment.courseId))) return 0;

  const scoreMaximum = assignment.problems.reduce((sum, p) => sum + Number(p.maxPoints ?? 0), 0);
  // Nothing to score against, so a percentage would be meaningless and the LMS would refuse it.
  if (scoreMaximum <= 0) return 0;

  /**
   * One student, when the caller named one.
   *
   * The per-student panel sends the grade it is showing and nothing else, so that pressing it
   * beside one student's work cannot quietly deliver somebody else's grade as well. The
   * assignment-wide path passes no id and still sends everything outstanding.
   */
  const forOne = opts.userId ? { studentId: opts.userId } : {};

  // The same sum the gradebook shows. Two ways of totalling a grade is how a student ends up
  // with different marks in two places.
  const totals = await prisma.assignmentProblemGrade.groupBy({
    by: ['studentId'],
    where: { assignmentId, ...forOne },
    _sum: { grade: true },
  });

  /**
   * Students carrying a zero for work nobody handed in.
   *
   * A derived zero adds no points, so it changes nobody's total. What it changes is who has a
   * score at all: a student who handed in nothing has no grade rows, so the groupBy above does
   * not mention them, and without this they would simply be missing from the LMS while AFCT
   * showed them a zero. Gated on the setting so an assignment that does not use it pays nothing
   * for the roster and submission reads this does.
   */
  const derivedZeros = assignment.missingWorkIsZero
    ? await studentsWithDerivedZeros(assignmentId)
    : new Set<string>();

  const totalByStudent = new Map(totals.map((t) => [t.studentId, t._sum.grade ?? 0]));

  /** Everyone who should hold a score in the LMS: marked work, missing work, or both. */
  const accountable = new Set<string>(totalByStudent.keys());
  for (const studentId of derivedZeros) {
    // The per-student path must not quietly deliver somebody else's score, the same rule the
    // grade totals follow above.
    if (!opts.userId || studentId === opts.userId) accountable.add(studentId);
  }

  const queued = await prisma.ltiScoreQueue.findMany({
    where: { assignmentId, ...(opts.userId ? { userId: opts.userId } : {}) },
    select: { userId: true, scoreGiven: true, scoreMaximum: true, state: true },
  });
  const known = new Map(queued.map((row) => [row.userId, row]));

  /** What each student should end up with: a number, or null to take their score away. */
  const wanted = new Map<string, number | null>();
  for (const studentId of accountable) {
    /**
     * Only the floor is enforced. AGS requires a scoreGiven of zero or more, so a correction
     * that leaves a total negative is sent as 0; but it also requires platforms to accept a
     * scoreGiven above scoreMaximum, which is how extra credit is expressed. Capping at the
     * maximum here silently reported 100/100 for a student who had earned 105, and a wrong
     * grade is the one failure this system must not produce quietly.
     */
    wanted.set(studentId, Math.max(totalByStudent.get(studentId) ?? 0, 0));
  }

  /**
   * Anyone already sent a score who is no longer accountable for anything gets it taken back.
   *
   * This is what makes the missing-work zero reversible in the LMS as well as in AFCT: grant an
   * extension after the zero went out, or turn the setting off, and the student stops being
   * accountable, so the score has to go rather than sit at nought for ever. It also covers a
   * grade being deleted outright, which previously left the old number in the LMS with nothing
   * to correct it.
   */
  for (const userId of known.keys()) {
    if (!wanted.has(userId)) wanted.set(userId, null);
  }

  let count = 0;
  for (const [userId, scoreGiven] of wanted) {
    const existing = known.get(userId);

    /**
     * Already queued or delivered with the same numbers: nothing to do.
     *
     * A failed one stays failed. Retrying automatically means retrying every minute for ever,
     * against a cause only a person can fix, and each attempt can leave litter behind: an
     * earlier version of this re-queued failed rows and produced a duplicate gradebook column
     * per attempt. Faculty retry deliberately with "send grades now".
     */
    const unchanged =
      existing && existing.scoreGiven === scoreGiven && existing.scoreMaximum === scoreMaximum;
    if (unchanged && (existing.state !== 'FAILED' || !opts.retryFailed)) continue;

    // Nothing to take back from a platform that was never told anything in the first place.
    if (scoreGiven === null && !existing) continue;

    await queueScore({ assignmentId, userId, scoreGiven, scoreMaximum });
    count++;
  }

  return count;
}

/**
 * What faculty are shown for one assignment, plus one student's own grade when asked.
 *
 * Both, rather than one or the other: the panel beside a student's work reports on that
 * student, and still has to say whether anybody else's grade is outstanding, or the only way
 * to notice a failure elsewhere would be to open all thirty students in turn.
 */
export async function assignmentSyncState(assignmentId: string, userId?: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { courseId: true, ltiAutoSync: true },
  });
  if (!assignment) return null;

  const linked = await courseIsLinked(assignment.courseId);
  const summary = await scoreQueueSummary(assignmentId);
  const student = userId ? await studentScoreState(assignmentId, userId) : null;

  return { linked, autoSync: assignment.ltiAutoSync, ...summary, student };
}

/** Queue changed grades for every assignment set to sync automatically. */
export async function queueAutomaticAssignments(): Promise<number> {
  const linkedCourses = await prisma.ltiContextLink.findMany({
    select: { courseId: true },
    distinct: ['courseId'],
  });
  if (linkedCourses.length === 0) return 0;

  const assignments = await prisma.assignment.findMany({
    where: { courseId: { in: linkedCourses.map((c) => c.courseId) }, ltiAutoSync: true },
    select: { id: true },
  });

  let total = 0;
  for (const assignment of assignments) {
    total += await queueChangedGrades(assignment.id);
  }
  return total;
}
