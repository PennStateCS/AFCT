import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';
import { withCourseAuth } from '@/lib/api/with-auth';
import { logDenial } from '@/lib/api/activity';

type SubmissionRecord = {
  id: string;
  submittedAt: Date;
  status: string;
  feedback: string | null;
  correct: boolean | null;
  evaluationRaw?: unknown;
  fileName: string | null;
  originalFileName: string | null;
  problemId: string;
};

const submissionSelectWithEvaluation = {
  id: true,
  submittedAt: true,
  status: true,
  feedback: true,
  correct: true,
  evaluationRaw: true,
  fileName: true,
  originalFileName: true,
  problemId: true,
} as const;

// Deliberately omits `evaluationRaw`: this is the fallback used when that optional
// column is absent (P2022), so it must NOT select it; otherwise the retry re-runs
// the identical failing query.
const submissionSelectWithoutEvaluation = {
  id: true,
  submittedAt: true,
  status: true,
  feedback: true,
  correct: true,
  fileName: true,
  originalFileName: true,
  problemId: true,
} as const;

/**
 * Assembles the grading/review view for one student on one assignment: their
 * submissions (grouped by problem, with evaluation output), the comments about
 * them, and their per-problem grades. Falls back gracefully if the optional
 * `evaluationRaw` column is absent.
 *
 * Access: the student themselves, course staff, or a system admin (`studentId` must
 * be the caller's id unless they are course staff or a system admin). Course
 * membership is also required, except for global admins.
 * @openapi
 * summary: Get a student's review data for an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: studentId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: Submissions (by problem), comments, and problem grades for the student.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             submissions: { type: object }
 *             comments: { type: array, items: { type: object } }
 *             problemGrades: { type: object }
 *   401: { description: Not signed in. }
 *   403: { description: "Requesting another student's data without being course staff or a system admin, or not an enrolled member of the course." }
 *   404: { description: Assignment not found for this course. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { aid: assignmentId, studentId } = await ctx.params;

    try {
      const assignment = await prisma.assignment.findFirst({
        where: { id: assignmentId, courseId },
        select: { id: true, isPublished: true },
      });

      if (!assignment) {
        return NextResponse.json(
          { error: 'Assignment not found for this course' },
          { status: 404 },
        );
      }

      const isStaff = await canManageCourse(user, courseId);

      // A student must not read review data (which includes problem content) for an
      // unpublished assignment, even their own; mask it as 404, like the reads.
      if (!assignment.isPublished && !isStaff) {
        return NextResponse.json(
          { error: 'Assignment not found for this course' },
          { status: 404 },
        );
      }

      // Students may only read their own review data; staff may read anyone's. (The
      // wrapper already enforced course membership via canAccessCourse.)
      if (!isStaff && user.id !== studentId) {
        return logDenial(req, {
          userId: user.id,
          action: 'REVIEW_DATA_ACCESS_DENIED',
          category: 'SUBMISSION',
          courseId,
        });
      }

      const [assignmentProblems, commentsRaw, gradesRaw] = await Promise.all([
        prisma.assignmentProblem.findMany({
          where: { assignmentId },
          include: {
            problem: {
              select: {
                id: true,
                title: true,
                description: true,
                type: true,
                maxStates: true,
                isDeterministic: true,
                originalFileName: true,
              },
            },
          },
        }),
        prisma.comment.findMany({
          where: {
            assignmentId,
            OR: [{ aboutStudentId: studentId }, { authorId: studentId }],
          },
          include: {
            author: { select: { id: true, firstName: true, lastName: true, avatar: true } },
            roster: { select: { role: true } }, // course role for the badge, may be null
          },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.assignmentProblemGrade.findMany({
          where: { assignmentId, studentId },
          select: { problemId: true, grade: true, feedback: true, updatedAt: true },
        }),
      ]);

      let submissionsRaw: SubmissionRecord[] = [];
      try {
        submissionsRaw = (await prisma.submission.findMany({
          where: { assignmentId, studentId },
          orderBy: { submittedAt: 'desc' },
          select: submissionSelectWithEvaluation as unknown as Prisma.SubmissionSelect,
        })) as SubmissionRecord[];
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2022' &&
          String(error.meta?.column ?? '').includes('evaluationRaw')
        ) {
          submissionsRaw = (await prisma.submission.findMany({
            where: { assignmentId, studentId },
            orderBy: { submittedAt: 'desc' },
            select: submissionSelectWithoutEvaluation,
          })) as SubmissionRecord[];
        } else {
          throw error;
        }
      }

      const submissionsByProblem: Record<
        string,
        {
          problem: {
            id: string;
            title: string;
            description: string | null;
            type: string | null;
            maxStates: number | null;
            isDeterministic: boolean | null;
            originalFileName: string | null;
          };
          submissions: {
            id: string;
            submittedAt: Date;
            status: string;
            feedback: string | null;
            correct: boolean | null;
            evaluationRaw?: unknown | null;
            fileName: string | null;
            originalFileName: string | null;
          }[];
        }
      > = {};

      for (const { problem } of assignmentProblems) {
        const subsForProblem = submissionsRaw.filter((s) => s.problemId === problem.id);
        submissionsByProblem[problem.id] = {
          // The problem's solution filename is instructor-only; hide it from students.
          problem: { ...problem, originalFileName: isStaff ? problem.originalFileName : null },
          submissions: subsForProblem.map((s) => ({
            id: s.id,
            submittedAt: s.submittedAt,
            status: s.status,
            feedback: s.feedback,
            correct: s.correct,
            evaluationRaw: s.evaluationRaw ?? null,
            fileName: s.fileName,
            originalFileName: s.originalFileName,
          })),
        };
      }

      const comments = commentsRaw.map((comment) => ({
        id: comment.id,
        content: comment.content,
        createdAt: comment.createdAt,
        problemId: comment.problemId,
        author: {
          id: comment.author.id,
          firstName: comment.author.firstName ?? null,
          lastName: comment.author.lastName ?? null,
          avatar: comment.author.avatar ?? null,
          role: comment.roster?.role ?? null,
        },
      }));

      const problemGrades = gradesRaw.reduce<
        Record<string, { grade: number | null; feedback: string | null; updatedAt: string }>
      >((acc, record) => {
        acc[record.problemId] = {
          grade: record.grade ?? null,
          feedback: record.feedback ?? null,
          updatedAt: record.updatedAt.toISOString(),
        };
        return acc;
      }, {});

      try {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'VIEW_STUDENT_REVIEW_DATA',
          severity: 'INFO',
          category: 'SUBMISSION',
          courseId,
          assignmentId,
          metadata: {
            userId: user.id,
            courseId,
            assignmentId,
            viewedStudentId: studentId,
            source: 'review-data',
          },
        });
      } catch (logError) {
        console.warn('Failed to log activity:', logError);
      }

      return NextResponse.json({
        submissions: submissionsByProblem,
        comments,
        problemGrades,
      });
    } catch (error) {
      console.error('GET /api/courses/[id]/[aid]/review-data/[studentId]/route.ts error:', error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { access: 'read', deniedAction: 'REVIEW_DATA_ACCESS_DENIED' },
);
