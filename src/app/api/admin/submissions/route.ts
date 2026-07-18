import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { logError } from '@/lib/api/activity';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';

const ListSubmissionsBody = z.object({ problemIds: z.array(z.string()).default([]) });

/**
 * Returns every submission across a set of problems, flattened for the admin
 * grading view: student, course, assignment/problem titles, status, and the
 * recorded grade (joined from AssignmentProblemGrade). System administrators only.
 * Takes the problem ids in the body rather than the query string since the list
 * can be long.
 * @openapi
 * summary: List submissions for problems (admin)
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [problemIds]
 *         properties:
 *           problemIds: { type: array, items: { type: string } }
 * responses:
 *   200:
 *     description: Flattened submissions, newest first.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   400: { description: problemIds missing or empty. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not a system administrator. }
 *   500: { description: Server error. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { user }) => {
    try {
      const parsed = await readJson(req, ListSubmissionsBody);
      if (!parsed.ok) return parsed.response;
      const problemIds = parsed.data.problemIds;

      if (problemIds.length === 0) {
        return NextResponse.json({ error: 'Missing problemIds' }, { status: 400 });
      }

      const submissions = await prisma.submission.findMany({
        where: {
          problemId: { in: problemIds },
        },
        orderBy: {
          submittedAt: 'desc',
        },
        select: {
          id: true,
          studentId: true,
          courseId: true,
          assignmentId: true,
          problemId: true,
          correct: true,
          feedback: true,
          student: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
              avatar: true,
              cropX: true,
              cropY: true,
              zoom: true,
            },
          },
          course: {
            select: { name: true },
          },
          assignmentProblem: {
            select: {
              assignment: {
                select: { title: true },
              },
              problem: {
                select: { title: true },
              },
              maxPoints: true,
            },
          },
          submittedAt: true,
          status: true,
          fileName: true,
          originalFileName: true,
        },
      });

      const gradeMap = new Map(
        (
          await prisma.assignmentProblemGrade.findMany({
            where: {
              studentId: { in: submissions.map((submission) => submission.studentId) },
              assignmentId: { in: submissions.map((submission) => submission.assignmentId) },
              problemId: { in: submissions.map((submission) => submission.problemId) },
            },
            select: {
              studentId: true,
              assignmentId: true,
              problemId: true,
              grade: true,
            },
          })
        ).map(
          (row) => [`${row.studentId}:${row.assignmentId}:${row.problemId}`, row.grade] as const,
        ),
      );

      const formattedSubmissions = submissions.map((submission) => ({
        id: submission.id,
        studentId: submission.studentId,
        courseId: submission.courseId,
        assignmentId: submission.assignmentId,
        problemId: submission.problemId,
        studentFirstName: submission.student.firstName,
        studentLastName: submission.student.lastName,
        studentEmail: submission.student.email,
        courseName: submission.course.name,
        assignmentTitle: submission.assignmentProblem.assignment.title,
        problemTitle: submission.assignmentProblem.problem.title,
        submittedAt: submission.submittedAt.toISOString(),
        status: submission.status,
        correct: submission.correct,
        feedback: submission.feedback,
        grade:
          gradeMap.get(
            `${submission.studentId}:${submission.assignmentId}:${submission.problemId}`,
          ) ?? null,
        maxPoints: submission.assignmentProblem.maxPoints,
        avatar: submission.student.avatar,
        cropX: submission.student.cropX,
        cropY: submission.student.cropY,
        zoom: submission.student.zoom,
        fileName: submission.fileName,
        originalFileName: submission.originalFileName,
      }));

      return NextResponse.json(formattedSubmissions);
    } catch (error) {
      console.error('Error fetching submissions:', error);
      await logError(req, {
        userId: user.id,
        action: 'ADMIN_SUBMISSIONS_ERROR',
        category: 'SUBMISSION',
        error,
      });
      return NextResponse.json({ error: 'Failed to fetch submissions' }, { status: 500 });
    }
  },
  { deniedAction: 'ADMIN_SUBMISSIONS_ACCESS_DENIED' },
);
