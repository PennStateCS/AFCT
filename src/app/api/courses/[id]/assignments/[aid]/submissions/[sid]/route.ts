import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';
import { withCourseAuth } from '@/lib/api/with-auth';
import { logDenial } from '@/lib/api/activity';

// Types
interface Submission {
  id: string;
  submittedAt: Date;
  feedback: string;
  correct: boolean;
  evaluationRaw?: unknown;
  fileName: string;
  originalFileName: string;
  problemId: string;
}

const submissionSelectWithEvaluation = {
  id: true,
  submittedAt: true,
  feedback: true,
  correct: true,
  evaluationRaw: true,
  fileName: true,
  originalFileName: true,
  problemId: true,
} as const;

const submissionSelectWithoutEvaluation = {
  id: true,
  submittedAt: true,
  feedback: true,
  correct: true,
  fileName: true,
  originalFileName: true,
  problemId: true,
} as const;

/**
 * Returns a student's submissions for an assignment, grouped by problem and each
 * annotated with that problem's metadata (falls back gracefully if the optional
 * `evaluationRaw` column is absent). The `[sid]` segment is the student id.
 *
 * Access: the student themselves, course staff, or a system admin (`sid` must be the
 * caller's id unless they are course staff or a system admin). Course membership is
 * also required, except for global admins.
 * @openapi
 * summary: Get a student's submissions for an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: sid, in: path, required: true, description: Student id, schema: { type: string } }
 * responses:
 *   200:
 *     description: Submissions grouped by problem.
 *     content:
 *       application/json:
 *         schema: { type: object }
 *   401: { description: Not signed in. }
 *   403: { description: "Requesting another student's submissions without being course staff or a system admin, or not an enrolled member of the course." }
 *   404: { description: "Assignment not found, or it has no linked problems." }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { aid: assignmentId, sid: studentId } = await ctx.params;

    try {
      // Verify that the assignment belongs to the given course
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

      // A student must not read submissions (which include problem content) for an
      // unpublished assignment, even their own; mask it as 404, like the reads.
      if (!assignment.isPublished && !isStaff) {
        return NextResponse.json(
          { error: 'Assignment not found for this course' },
          { status: 404 },
        );
      }

      // Students may only read their own submissions; staff may read anyone's. (The
      // wrapper already enforced course membership via canAccessCourse.)
      if (!isStaff && user.id !== studentId) {
        return logDenial(req, {
          userId: user.id,
          action: 'SUBMISSIONS_ACCESS_DENIED',
          category: 'SUBMISSION',
          courseId,
        });
      }

      // Get all problems linked to the assignment
      const assignmentProblems = await prisma.assignmentProblem.findMany({
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
      });

      if (assignmentProblems.length === 0) {
        return NextResponse.json(
          { error: 'No problems linked to this assignment' },
          { status: 404 },
        );
      }

      // Fetch all submissions for the student for this assignment
      let submissions: Submission[] = [];
      try {
        submissions = (await prisma.submission.findMany({
          where: {
            assignmentId,
            studentId,
          },
          orderBy: { submittedAt: 'desc' },
          select: submissionSelectWithEvaluation as unknown as Prisma.SubmissionSelect,
        })) as Submission[];
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2022' &&
          String(error.meta?.column ?? '').includes('evaluationRaw')
        ) {
          submissions = (await prisma.submission.findMany({
            where: {
              assignmentId,
              studentId,
            },
            orderBy: { submittedAt: 'desc' },
            select: submissionSelectWithoutEvaluation,
          })) as Submission[];
        } else {
          throw error;
        }
      }

      // Group submissions by problemId and attach related problem metadata
      const result: Record<
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
            feedback: string | null;
            correct: boolean | null;
            evaluationRaw?: unknown | null;
            fileName: string | null;
            originalFileName: string | null;
          }[];
        }
      > = {};

      for (const { problem } of assignmentProblems) {
        const subsForProblem = submissions.filter(
          (s: (typeof submissions)[number]) => s.problemId === problem.id,
        );
        result[problem.id] = {
          // The problem's solution filename is instructor-only; hide it from students
          // (their own submission filenames below are theirs to see).
          problem: { ...problem, originalFileName: isStaff ? problem.originalFileName : null },
          submissions: subsForProblem.map((s: (typeof subsForProblem)[number]) => ({
            id: s.id,
            submittedAt: s.submittedAt,
            feedback: s.feedback,
            correct: s.correct,
            evaluationRaw: s.evaluationRaw ?? null,
            fileName: s.fileName,
            originalFileName: s.originalFileName,
          })),
        };
      }

      // Log access to assignment submissions
      try {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'VIEW_ASSIGNMENT_SUBMISSIONS',
          severity: 'INFO',
          category: 'SUBMISSION',
          courseId,
          assignmentId,
          metadata: {
            userId: user.id,
            courseId: courseId,
            assignmentId: assignmentId,
            viewedStudentId: studentId,
          },
        });
      } catch (logError) {
        console.warn('Failed to log activity:', logError);
        // Don't fail the whole request if logging fails
      }

      // Return structured submission data grouped by problem
      return NextResponse.json(result);
    } catch (err) {
      // Catch unexpected errors
      console.error('Error fetching submissions:', err);
      return NextResponse.json({ error: 'Failed to fetch submissions' }, { status: 500 });
    }
  },
  { access: 'read', deniedAction: 'SUBMISSIONS_ACCESS_DENIED' },
);
