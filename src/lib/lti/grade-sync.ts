/**
 * Deciding which grades still need to reach the LMS.
 *
 * Derived by comparing each student's current grade against what was last queued, rather than
 * hooking every place a grade is written. Grades are written from several routes and the worker,
 * and a hook missing from one of them would lose marks silently. This way a grade changed while
 * the LMS was down is picked up on the next pass, with nothing to remember to call.
 */

import { prisma } from '@/lib/prisma';
import { queueScore, scoreQueueSummary } from '@/lib/lti/score-queue';

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
  opts: { retryFailed?: boolean } = {},
): Promise<number> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      courseId: true,
      problems: { select: { maxPoints: true } },
    },
  });
  if (!assignment) return 0;
  if (!(await courseIsLinked(assignment.courseId))) return 0;

  const scoreMaximum = assignment.problems.reduce((sum, p) => sum + Number(p.maxPoints ?? 0), 0);
  // Nothing to score against, so a percentage would be meaningless and the LMS would refuse it.
  if (scoreMaximum <= 0) return 0;

  // The same sum the gradebook shows. Two ways of totalling a grade is how a student ends up
  // with different marks in two places.
  const totals = await prisma.assignmentProblemGrade.groupBy({
    by: ['studentId'],
    where: { assignmentId },
    _sum: { grade: true },
  });

  const queued = await prisma.ltiScoreQueue.findMany({
    where: { assignmentId },
    select: { userId: true, scoreGiven: true, scoreMaximum: true, state: true },
  });
  const known = new Map(queued.map((row) => [row.userId, row]));

  let count = 0;
  for (const total of totals) {
    /**
     * Held to the range the column accepts. Extra credit can push a total past the maximum and
     * a correction can leave it negative; platforms reject the whole request for either, which
     * would strand every grade in the batch rather than the one odd score.
     */
    const raw = total._sum.grade ?? 0;
    const scoreGiven = Math.min(Math.max(raw, 0), scoreMaximum);
    const existing = known.get(total.studentId);

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

    await queueScore({
      assignmentId,
      userId: total.studentId,
      scoreGiven,
      scoreMaximum,
    });
    count++;
  }

  return count;
}

/** What faculty are shown for one assignment. */
export async function assignmentSyncState(assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: { courseId: true, ltiAutoSync: true },
  });
  if (!assignment) return null;

  const linked = await courseIsLinked(assignment.courseId);
  const summary = await scoreQueueSummary(assignmentId);

  return { linked, autoSync: assignment.ltiAutoSync, ...summary };
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
