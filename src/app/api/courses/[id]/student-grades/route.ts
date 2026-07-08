import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Returns the signed-in student's own grade breakdown for a course — published
 * assignments, their problems, and per-problem grade, latest submission status,
 * and attempt count. Available to enrolled members (viewing their own data) and
 * to staff.
 * @openapi
 * summary: Get my grades for a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The caller's per-assignment, per-problem grade breakdown.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { assignments: { type: array, items: { type: object } } } }
 *   400: { description: Missing course id. }
 *   401: { description: Not signed in. }
 *   403: { description: Not enrolled and not staff. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (_req, _ctx, { user, courseId }) => {
    try {
      const assignments = await prisma.assignment.findMany({
        where: { courseId, isPublished: true },
        select: {
          id: true,
          title: true,
          description: true,
          dueDate: true,
        },
        orderBy: { dueDate: 'asc' },
      });

      const assignmentIds = assignments.map((assignment) => assignment.id);

      const problems = await prisma.assignmentProblem.findMany({
        where: { assignmentId: { in: assignmentIds } },
        select: {
          assignmentId: true,
          maxPoints: true,
          maxSubmissions: true,
          problem: {
            select: {
              id: true,
              title: true,
              autograderEnabled: true,
            },
          },
        },
        orderBy: { assignmentId: 'asc' },
      });

      const grades = await prisma.assignmentProblemGrade.findMany({
        where: {
          assignmentId: { in: assignmentIds },
          studentId: user.id,
        },
        select: {
          assignmentId: true,
          problemId: true,
          grade: true,
        },
      });

      const submissionCounts = await prisma.submission.groupBy({
        by: ['assignmentId', 'problemId'],
        where: {
          assignmentId: { in: assignmentIds },
          studentId: user.id,
        },
        _count: {
          id: true,
        },
      });

      // Get most recent status
      const latestSubmissions = await prisma.submission.findMany({
        where: {
          assignmentId: { in: assignmentIds },
          studentId: user.id,
        },
        distinct: ['assignmentId', 'problemId'],
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          assignmentId: true,
          problemId: true,
          status: true,
        },
      });

      const gradeMap = new Map<string, number | null>();
      grades.forEach((grade) => {
        gradeMap.set(`${grade.assignmentId}:${grade.problemId}`, grade.grade ?? null);
      });

      const submissionCountMap = new Map<string, number>();
      submissionCounts.forEach((item) => {
        submissionCountMap.set(`${item.assignmentId}:${item.problemId}`, item._count.id);
      });

      const submissionStatusMap = new Map<string, string>();
      latestSubmissions.forEach((item) => {
        submissionStatusMap.set(`${item.assignmentId}:${item.problemId}`, item.status);
      });

      const groupedProblems = problems.reduce<
        Record<
          string,
          Array<{
            id: string;
            title: string | null;
            autograderEnabled: boolean;
            maxPoints: number;
            maxSubmissions: number;
          }>
        >
      >((acc, problem) => {
        if (!acc[problem.assignmentId]) acc[problem.assignmentId] = [];
        acc[problem.assignmentId].push({
          id: problem.problem.id,
          title: problem.problem.title,
          autograderEnabled: problem.problem.autograderEnabled,
          maxPoints: Number(problem.maxPoints ?? 0),
          maxSubmissions: Number(problem.maxSubmissions ?? 0),
        });
        return acc;
      }, {});

      const payload = assignments.map((assignment) => {
        const assignmentProblems = groupedProblems[assignment.id] ?? [];
        const problemDetails = assignmentProblems.map((problem) => ({
          id: problem.id,
          title: problem.title,
          autograderEnabled: problem.autograderEnabled,
          maxPoints: problem.maxPoints,
          maxSubmissions: problem.maxSubmissions,
          status: submissionStatusMap.get(`${assignment.id}:${problem.id}`) ?? '',
          submissionCount: submissionCountMap.get(`${assignment.id}:${problem.id}`) ?? 0,
          grade: gradeMap.get(`${assignment.id}:${problem.id}`) ?? null,
        }));
        const maxPoints = problemDetails.reduce((sum, problem) => sum + problem.maxPoints, 0);
        const assignmentGrade = problemDetails.reduce(
          (sum, problem) => sum + (problem.grade ?? 0),
          0,
        );
        const hasGrade = problemDetails.some((problem) => problem.grade !== null);

        return {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          dueDate: assignment.dueDate?.toISOString() ?? null,
          maxPoints,
          grade: hasGrade ? assignmentGrade : null,
          problems: problemDetails,
        };
      });

      return NextResponse.json({ assignments: payload });
    } catch (error) {
      console.error('GET /api/courses/[id]/student-grades error:', error);
      const detail = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        {
          error: 'Failed to fetch student grades',
          detail: process.env.NODE_ENV === 'development' ? detail : undefined,
        },
        { status: 500 },
      );
    }
  },
  { access: 'read', deniedAction: 'COURSE_STUDENT_GRADES_ACCESS_DENIED' },
);
