import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canAccessCourse, canManageCourse } from '@/lib/permissions';

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

const submissionSelectWithoutEvaluation = {
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

/**
 * Assembles the grading/review view for one student on one assignment: their
 * submissions (grouped by problem, with evaluation output), the comments about
 * them, and their per-problem grades. Falls back gracefully if the optional
 * `evaluationRaw` column is absent.
 *
 * Access: staff (ADMIN/FACULTY/TA) may read any student's data; a non-staff user
 * may read only their own (`studentId` must be their id). Course membership is also
 * required, except for global admins.
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
 *   403: { description: "Not staff and requesting another student's data, or not enrolled." }
 *   404: { description: Assignment not found for this course. }
 *   500: { description: Server error. }
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string; aid: string; studentId: string }> },
) {
  const { id: courseId, aid: assignmentId, studentId } = await context.params;

  try {
    const session = await auth();
    const user = session?.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, courseId },
      select: { id: true },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found for this course' }, { status: 404 });
    }

    // Students may only read their own review data; staff may read anyone's.
    if (!(await canManageCourse(user, courseId)) && user.id !== studentId) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'REVIEW_DATA_ACCESS_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Course-membership requirement (global admins excepted), as before.
    if (!(await canAccessCourse(user, courseId))) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'REVIEW_DATA_ACCESS_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
          OR: [{ aboutStudentId: studentId }, { roster: { userId: studentId } }],
        },
        include: {
          roster: {
            select: {
              role: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
            },
          },
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
        problem,
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
        id: comment.roster.user.id,
        firstName: comment.roster.user.firstName ?? null,
        lastName: comment.roster.user.lastName ?? null,
        avatar: comment.roster.user.avatar ?? null,
        role: comment.roster.role ?? null,
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
        action: 'VIEW_ASSIGNMENT_SUBMISSIONS',
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
}
