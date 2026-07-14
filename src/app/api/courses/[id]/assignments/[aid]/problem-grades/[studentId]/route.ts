import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { logDenial, logError } from '@/lib/api/activity';
import { BatchProblemGradesSchema } from '@/schemas/grade';

// Concrete path params for this route. Next guarantees each dynamic segment is
// present, so typing them keeps the destructured values `string` (rather than
// `string | undefined`) under noUncheckedIndexedAccess.
type RouteCtx = { params: Promise<{ id: string; aid: string; studentId: string }> };

/**
 * Returns a student's per-problem grades and feedback for one assignment, keyed by
 * problem id. A student may read their own; staff may read anyone's. Responds 204
 * when nothing has been graded yet.
 * @openapi
 * summary: Get a student's problem grades for an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: studentId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: A map of problemId → { grade, feedback, updatedAt }.
 *     content:
 *       application/json:
 *         schema: { type: object }
 *   204: { description: No grades recorded yet. }
 *   401: { description: Not signed in. }
 *   403: { description: Not the student in question and not staff. }
 *   404: { description: Assignment not found in this course. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, ctx: RouteCtx, { user, courseId }) => {
    const { aid: assignmentId, studentId } = await ctx.params;

    try {
      const isStaff = await canManageCourse(user, courseId);

      // A student may read their own grades; staff may read anyone's. (The wrapper
      // already enforced course membership via canAccessCourse.)
      if (!isStaff && user.id !== studentId) {
        return logDenial(req, {
          userId: user.id,
          action: 'PROBLEM_GRADES_ACCESS_DENIED',
          courseId,
        });
      }

      const assignment = await prisma.assignment.findFirst({
        where: { id: assignmentId, courseId },
        select: { id: true, isPublished: true },
      });

      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      // Students can't read grades for an unpublished assignment (mask as 404).
      if (!assignment.isPublished && !isStaff) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      const grades = await prisma.assignmentProblemGrade.findMany({
        where: { assignmentId, studentId },
        select: { problemId: true, grade: true, feedback: true, updatedAt: true },
      });

      if (grades.length === 0) {
        return new NextResponse(null, { status: 204 });
      }

      const payload = grades.reduce<
        Record<string, { grade: number | null; feedback: string | null; updatedAt: string }>
      >((acc, record) => {
        acc[record.problemId] = {
          grade: record.grade ?? null,
          feedback: record.feedback ?? null,
          updatedAt: record.updatedAt.toISOString(),
        };
        return acc;
      }, {});

      return NextResponse.json(payload);
    } catch (error) {
      console.error('GET /api/courses/[id]/[aid]/problem-grades/[studentId] error:', error);
      return NextResponse.json({ error: 'Failed to fetch problem grades' }, { status: 500 });
    }
  },
  { access: 'read', deniedAction: 'PROBLEM_GRADES_ACCESS_DENIED' },
);

/**
 * Batch-saves this student's problem grades for the assignment in a single request;
 * the write counterpart to the GET above (co-located as the same resource). The body
 * maps problemId → grade (a number within [0, maxPoints], or null to clear). Course
 * staff (faculty or TAs) or a system admin. Only problems whose grade actually changed
 * are written: a null for a graded problem deletes it, a number upserts it (existing
 * feedback is left untouched), and unchanged problems are skipped. Every applied change
 * is audited with its previous value, mirroring the single-problem grade route.
 * @openapi
 * summary: Batch set/clear a student's problem grades for an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: studentId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [grades]
 *         properties:
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
export const POST = withCourseAuth(
  async (req, ctx: RouteCtx, { user, courseId }) => {
    const graderId = user.id;
    const { aid: assignmentId, studentId } = await ctx.params;

    try {
      const parsed = await readJson(req, BatchProblemGradesSchema);
      if (!parsed.ok) return parsed.response;
      const grades = parsed.data.grades;

      // The assignment must belong to this course.
      const assignment = await prisma.assignment.findFirst({
        where: { id: assignmentId, courseId },
        select: { id: true },
      });
      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      // The grade target must actually be enrolled in this course; never create
      // grade rows for an arbitrary user id that isn't on the roster.
      const enrolled = await prisma.roster.findFirst({
        where: { courseId, userId: studentId },
        select: { id: true },
      });
      if (!enrolled) {
        return NextResponse.json({ error: 'Student not enrolled in this course' }, { status: 404 });
      }

      // maxPoints per problem: used for validation and to reject problem ids that
      // don't belong to the assignment.
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
                targetUserId: studentId,
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
      } catch (logErr) {
        console.error(
          'POST /api/courses/[id]/[aid]/problem-grades/[studentId] audit error:',
          logErr,
        );
      }

      return NextResponse.json({ ok: true, changed: changes.length });
    } catch (error) {
      console.error('POST /api/courses/[id]/[aid]/problem-grades/[studentId] error:', error);
      await logError(req, {
        userId: graderId,
        action: 'PROBLEM_GRADE_UPDATE_ERROR',
        error,
      });
      return NextResponse.json({ error: 'Failed to save grades' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_GRADE_UPDATE_DENIED', blockWhenArchived: true },
);
