import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';

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
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; aid: string; studentId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: courseId, aid: assignmentId, studentId } = await params;

    if (!(await canManageCourse(session.user, courseId)) && session.user.id !== studentId) {
      await createEnhancedActivityLog(prisma, _req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_GRADES_ACCESS_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, courseId },
      select: { id: true },
    });

    if (!assignment) {
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
}
