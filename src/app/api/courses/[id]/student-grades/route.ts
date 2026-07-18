import { NextResponse } from 'next/server';
import { withCourseAuth } from '@/lib/api/with-auth';
import { getStudentCourseAssignments } from '@/lib/student-assignments';

/**
 * Returns the signed-in student's own grade breakdown for a course: published
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
      const assignments = await getStudentCourseAssignments(user.id, courseId);

      const payload = assignments.map((assignment) => {
        const maxPoints = assignment.problems.reduce((sum, p) => sum + p.maxPoints, 0);
        const assignmentGrade = assignment.problems.reduce((sum, p) => sum + (p.grade ?? 0), 0);
        const hasGrade = assignment.problems.some((p) => p.grade !== null);

        return {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          dueDate: assignment.dueDate?.toISOString() ?? null,
          maxPoints,
          grade: hasGrade ? assignmentGrade : null,
          problems: assignment.problems.map((p) => ({
            id: p.id,
            title: p.title,
            autograderEnabled: p.autograderEnabled,
            maxPoints: p.maxPoints,
            maxSubmissions: p.maxSubmissions,
            status: p.status,
            submissionCount: p.submissionCount,
            grade: p.grade,
          })),
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
  { access: 'read', deniedAction: 'COURSE_STUDENT_GRADES_ACCESS_DENIED', deniedCategory: 'GRADE' },
);
