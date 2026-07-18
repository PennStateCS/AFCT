import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';

/**
 * Per-student completion summary for one assignment: maps each student to whether
 * every problem in the assignment has been graded (used to flag fully-graded
 * students in the grading UI). Course staff (faculty or TAs) or a system admin.
 * @openapi
 * summary: Get an assignment's grading-completion summary
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: A map of studentId → fully-graded boolean (empty object if the assignment has no problems).
 *     content:
 *       application/json:
 *         schema: { type: object, additionalProperties: { type: boolean } }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: Assignment not found in this course. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (_req, ctx, { courseId }) => {
    try {
      const { aid: assignmentId } = await ctx.params;

      const assignment = await prisma.assignment.findFirst({
        where: { id: assignmentId, courseId },
        select: { id: true },
      });

      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      const problemCount = await prisma.assignmentProblem.count({ where: { assignmentId } });
      if (problemCount === 0) {
        return NextResponse.json({});
      }

      const gradeGroups = await prisma.assignmentProblemGrade.groupBy({
        by: ['studentId'],
        where: { assignmentId },
        _count: { grade: true },
      });

      const payload: Record<string, boolean> = {};
      for (const group of gradeGroups) {
        payload[group.studentId] = group._count.grade >= problemCount;
      }

      return NextResponse.json(payload);
    } catch (error) {
      console.error('GET /api/courses/[id]/[aid]/problem-grades/summary error:', error);
      return NextResponse.json({ error: 'Failed to fetch grade summary' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_GRADES_SUMMARY_ACCESS_DENIED', deniedCategory: 'GRADE' },
);
