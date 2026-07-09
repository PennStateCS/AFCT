import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canManageCourse } from '@/lib/permissions';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Everything the caller needs to see their own work on an assignment, grouped by
 * problem: their submissions, the comments addressed to them, and their per-problem
 * and overall grades. Requires enrollment in the course; students can't see it
 * until the assignment is published. Scoped entirely to the caller's own data.
 * @openapi
 * summary: Get my context for an assignment
 * parameters:
 *   - { name: id, in: path, required: true, description: Course id, schema: { type: string } }
 *   - { name: aid, in: path, required: true, description: Assignment id, schema: { type: string } }
 * responses:
 *   200:
 *     description: The caller's submissions, comments, and grades for the assignment.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             assignmentGrade: { type: number, nullable: true }
 *             problemGrades: { type: object }
 *             submissionCount: { type: integer }
 *             submissionsByProblem: { type: object }
 *             commentsByProblem: { type: object }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not enrolled in the course. }
 *   404: { description: "Assignment not found in this course, or unpublished (for students)." }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (_req, ctx, { user, courseId }) => {
    const { aid: assignmentId } = await ctx.params;
    const userId = user.id;

    try {
      const assignment = await prisma.assignment.findFirst({
        where: { id: assignmentId, courseId },
        select: {
          id: true,
          isPublished: true,
          problems: {
            select: {
              problemId: true,
            },
          },
        },
      });

      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      if (!assignment.isPublished && !(await canManageCourse(user, courseId))) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      const problemIds = assignment.problems.map((problem) => problem.problemId);

      const [submissions, comments, grades] = await Promise.all([
        prisma.submission.findMany({
          where: {
            assignmentId,
            studentId: userId,
            problemId: { in: problemIds },
          },
          orderBy: { submittedAt: 'desc' },
          select: {
            id: true,
            submittedAt: true,
            feedback: true,
            correct: true,
            fileName: true,
            originalFileName: true,
            problemId: true,
            status: true,
          },
        }),
        prisma.comment.findMany({
          where: {
            assignmentId,
            problemId: { in: problemIds },
            OR: [{ aboutStudentId: userId }, { roster: { userId } }],
          },
          include: {
            roster: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.assignmentProblemGrade.findMany({
          where: {
            assignmentId,
            studentId: userId,
            problemId: { in: problemIds },
          },
          select: {
            problemId: true,
            grade: true,
          },
        }),
      ]);

      const submissionsByProblem: Record<string, (typeof submissions)[number][]> = {};
      for (const problemId of problemIds) {
        submissionsByProblem[problemId] = [];
      }

      for (const submission of submissions) {
        if (!submissionsByProblem[submission.problemId]) {
          submissionsByProblem[submission.problemId] = [];
        }
        submissionsByProblem[submission.problemId].push(submission);
      }

      const commentsByProblem: Record<string, (typeof comments)[number][]> = {};
      for (const problemId of problemIds) {
        commentsByProblem[problemId] = [];
      }

      for (const comment of comments) {
        if (!commentsByProblem[comment.problemId]) {
          commentsByProblem[comment.problemId] = [];
        }
        commentsByProblem[comment.problemId].push(comment);
      }

      const gradeMap = new Map(grades.map((grade) => [grade.problemId, grade.grade]));
      const problemGrades = Object.fromEntries(
        problemIds.map((problemId) => [problemId, gradeMap.get(problemId) ?? null]),
      );
      const gradesList = Object.values(problemGrades);
      const hasAnyGrade = gradesList.some((grade) => grade !== null);
      const assignmentGrade = hasAnyGrade
        ? gradesList.reduce((sum: number, grade) => sum + (grade ?? 0), 0)
        : null;

      return NextResponse.json({
        assignmentGrade,
        problemGrades,
        submissionCount: submissions.length,
        submissionsByProblem: Object.fromEntries(
          Object.entries(submissionsByProblem).map(([problemId, problemSubmissions]) => [
            problemId,
            problemSubmissions.map((submission) => ({
              id: submission.id,
              submittedAt: submission.submittedAt.toISOString(),
              grade: gradeMap.get(submission.problemId) ?? null,
              feedback: submission.feedback,
              correct: submission.correct,
              fileName: submission.fileName,
              originalFileName: submission.originalFileName,
              problemId: submission.problemId,
              status: submission.status,
            })),
          ]),
        ),
        commentsByProblem: Object.fromEntries(
          Object.entries(commentsByProblem).map(([problemId, problemComments]) => [
            problemId,
            problemComments.map((comment) => ({
              id: comment.id,
              content: comment.content,
              createdAt: comment.createdAt.toISOString(),
              authorId: comment.roster?.userId ?? null,
              authorName:
                [comment.roster?.user?.firstName, comment.roster?.user?.lastName]
                  .filter(Boolean)
                  .join(' ') || 'Unknown',
              authorRole: comment.roster?.role ?? 'STUDENT',
              problemId: comment.problemId,
            })),
          ]),
        ),
      });
    } catch (error) {
      console.error('GET student-context error:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { access: 'read', deniedAction: 'ASSIGNMENT_STUDENT_CONTEXT_DENIED' },
);
