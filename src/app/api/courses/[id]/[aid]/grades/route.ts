import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

/**
 * Batch-saves one student's problem grades for an assignment in a single request —
 * the replacement for firing one POST per problem. The body maps problemId → grade
 * (a number within [0, maxPoints], or null to clear). Course staff (faculty or TAs)
 * or a system admin. Only problems whose grade actually changed are written: a null
 * for a graded problem deletes it, a number upserts it (existing feedback is left
 * untouched), and unchanged problems are skipped. Every applied change is audited
 * with its previous value, mirroring the single-problem grade route.
 * @openapi
 * summary: Batch set/clear a student's problem grades for an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [studentId, grades]
 *         properties:
 *           studentId: { type: string }
 *           grades:
 *             type: object
 *             additionalProperties: { type: number, nullable: true }
 *             description: "Map of problemId to grade (0..maxPoints) or null to clear."
 * responses:
 *   200: { description: "Batch applied; returns the number of problems changed." }
 *   400: { description: "Bad body, unknown problem id, or a grade out of range." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: Assignment not found in this course. }
 *   500: { description: Server error. }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; aid: string }> },
) {
  let graderId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    graderId = session.user.id;

    const { id: courseId, aid: assignmentId } = await params;

    if (!(await canManageCourse(session.user, courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_GRADE_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const studentId = typeof body?.studentId === 'string' ? body.studentId : null;
    const grades = body?.grades;
    if (!studentId || typeof grades !== 'object' || grades === null || Array.isArray(grades)) {
      return NextResponse.json(
        { error: 'studentId and a grades map are required' },
        { status: 400 },
      );
    }

    // The assignment must belong to this course.
    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, courseId },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // maxPoints per problem in this assignment — used for validation and to reject
    // problem ids that don't belong to the assignment.
    const assignmentProblems = await prisma.assignmentProblem.findMany({
      where: { assignmentId },
      select: { problemId: true, maxPoints: true },
    });
    const maxByProblem = new Map(assignmentProblems.map((ap) => [ap.problemId, ap.maxPoints]));

    const entries = Object.entries(grades) as Array<[string, unknown]>;
    for (const [problemId, value] of entries) {
      if (!maxByProblem.has(problemId)) {
        return NextResponse.json(
          { error: `Problem ${problemId} is not part of this assignment` },
          { status: 400 },
        );
      }
      if (value !== null && value !== undefined) {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          return NextResponse.json(
            { error: `Grade for problem ${problemId} must be a number or null` },
            { status: 400 },
          );
        }
        const max = maxByProblem.get(problemId) ?? 0;
        if (value < 0 || value > max) {
          return NextResponse.json(
            { error: `Grade for problem ${problemId} is out of range` },
            { status: 400 },
          );
        }
      }
    }

    // Existing grades so we only write (and audit) what actually changed.
    const existingRows = await prisma.assignmentProblemGrade.findMany({
      where: { assignmentId, studentId },
      select: { problemId: true, grade: true },
    });
    const existingByProblem = new Map(existingRows.map((r) => [r.problemId, r.grade ?? null]));

    type Change = { problemId: string; previousGrade: number | null; grade: number | null };
    const changes: Change[] = [];
    for (const [problemId, rawValue] of entries) {
      const nextGrade = rawValue === null || rawValue === undefined ? null : (rawValue as number);
      const prevGrade = existingByProblem.get(problemId) ?? null;
      if (nextGrade === prevGrade) continue; // no-op
      changes.push({ problemId, previousGrade: prevGrade, grade: nextGrade });
    }

    if (changes.length === 0) {
      return NextResponse.json({ ok: true, changed: 0 });
    }

    // Apply all changes atomically. Upserts set only `grade`, leaving any existing
    // feedback intact (a grade-only edit must not erase written feedback).
    await prisma.$transaction(
      changes.map((change) =>
        change.grade === null
          ? prisma.assignmentProblemGrade.deleteMany({
              where: { assignmentId, problemId: change.problemId, studentId },
            })
          : prisma.assignmentProblemGrade.upsert({
              where: {
                assignmentId_problemId_studentId: {
                  assignmentId,
                  problemId: change.problemId,
                  studentId,
                },
              },
              create: {
                assignmentId,
                problemId: change.problemId,
                studentId,
                grade: change.grade,
                feedback: null,
              },
              update: { grade: change.grade },
            }),
      ),
    );

    // Audit each applied change (best-effort; grades are already committed).
    try {
      await Promise.all(
        changes.map((change) =>
          createEnhancedActivityLog(prisma, req, {
            userId: graderId,
            action: change.grade === null ? 'PROBLEM_GRADE_CLEARED' : 'PROBLEM_GRADE_UPDATED',
            severity: 'INFO',
            category: 'SUBMISSION',
            courseId,
            assignmentId,
            problemId: change.problemId,
            metadata: {
              studentId,
              graderId,
              previousGrade: change.previousGrade,
              grade: change.grade,
              maxPoints: maxByProblem.get(change.problemId) ?? null,
              batch: true,
            },
          }),
        ),
      );
    } catch (logError) {
      console.error('POST /api/courses/[id]/[aid]/grades audit error:', logError);
    }

    return NextResponse.json({ ok: true, changed: changes.length });
  } catch (error) {
    console.error('POST /api/courses/[id]/[aid]/grades error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: graderId,
      action: 'PROBLEM_GRADE_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to save grades' }, { status: 500 });
  }
}
