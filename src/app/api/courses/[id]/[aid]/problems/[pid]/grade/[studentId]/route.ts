import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

/**
 * Reads one student's grade and feedback for a specific problem within an
 * assignment. A student may read their own; staff may read anyone's. Returns nulls
 * (not 404) when the problem exists but hasn't been graded.
 * @openapi
 * summary: Get a single problem grade
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 *   - { name: studentId, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The grade, feedback, and updatedAt (grade/feedback null if ungraded).
 *   401: { description: Not signed in. }
 *   403: { description: Not the student in question and not staff. }
 *   404: { description: Problem not found in this assignment/course. }
 *   500: { description: Server error. }
 */
export async function GET(
  _req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; aid: string; pid: string; studentId: string }>;
  },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: courseId, aid: assignmentId, pid: problemId, studentId } = await params;

    const isStaff = ['ADMIN', 'FACULTY', 'TA'].includes(session.user.role);
    if (session.user.id !== studentId && !isStaff) {
      await createEnhancedActivityLog(prisma, _req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_GRADE_ACCESS_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const assignmentProblem = await prisma.assignmentProblem.findUnique({
      where: {
        assignmentId_problemId: {
          assignmentId,
          problemId,
        },
      },
      select: {
        assignment: { select: { courseId: true } },
      },
    });

    if (!assignmentProblem || assignmentProblem.assignment.courseId !== courseId) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
    }

    const grade = await prisma.assignmentProblemGrade.findUnique({
      where: {
        assignmentId_problemId_studentId: {
          assignmentId,
          problemId,
          studentId,
        },
      },
    });

    if (!grade) {
      return NextResponse.json({ grade: null, feedback: null });
    }

    return NextResponse.json({
      grade: grade.grade ?? null,
      feedback: grade.feedback ?? null,
      updatedAt: grade.updatedAt,
    });
  } catch (error) {
    console.error('GET /api/courses/[id]/[aid]/problems/[pid]/grade/[studentId] error:', error);
    return NextResponse.json({ error: 'Failed to fetch problem grade' }, { status: 500 });
  }
}

/**
 * Sets or clears a student's grade (and optional feedback) for one problem. Staff
 * only (ADMIN/FACULTY/TA). A numeric grade must be within [0, maxPoints]; sending
 * a null grade deletes the record. Every change is audited with the previous value.
 * @openapi
 * summary: Set or clear a problem grade
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 *   - { name: studentId, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           grade: { type: number, nullable: true, description: "0..maxPoints, or null to clear" }
 *           feedback: { type: string, nullable: true }
 * responses:
 *   200: { description: The saved (or cleared) grade and feedback. }
 *   400: { description: "Grade not a number/null, or out of range." }
 *   401: { description: Not signed in. }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Problem not found in this assignment/course. }
 *   500: { description: Server error. }
 */
export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; aid: string; pid: string; studentId: string }>;
  },
) {
  let graderId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    graderId = session.user.id;

    if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_GRADE_UPDATE_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id: courseId, aid: assignmentId, pid: problemId, studentId } = await params;

    const assignmentProblem = await prisma.assignmentProblem.findUnique({
      where: {
        assignmentId_problemId: {
          assignmentId,
          problemId,
        },
      },
      select: {
        assignment: { select: { courseId: true } },
        maxPoints: true,
      },
    });

    if (!assignmentProblem || assignmentProblem.assignment.courseId !== courseId) {
      return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
    }

    const body = await req.json();
    const grade = body?.grade as number | null | undefined;
    const feedback = typeof body?.feedback === 'string' ? body.feedback : null;

    if (grade !== null && grade !== undefined) {
      if (typeof grade !== 'number' || Number.isNaN(grade)) {
        return NextResponse.json({ error: 'Grade must be a number or null' }, { status: 400 });
      }
      if (grade < 0 || grade > assignmentProblem.maxPoints) {
        return NextResponse.json({ error: 'Grade out of range for this problem' }, { status: 400 });
      }
    }

    // Capture the prior grade so the audit records the before → after change.
    const existing = await prisma.assignmentProblemGrade.findUnique({
      where: {
        assignmentId_problemId_studentId: { assignmentId, problemId, studentId },
      },
      select: { grade: true, feedback: true },
    });

    if (grade === null || grade === undefined) {
      await prisma.assignmentProblemGrade.deleteMany({
        where: {
          assignmentId,
          problemId,
          studentId,
        },
      });
      await createEnhancedActivityLog(prisma, req, {
        userId: graderId,
        action: 'PROBLEM_GRADE_CLEARED',
        severity: 'INFO',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: { studentId, graderId, previousGrade: existing?.grade ?? null },
      });
      return NextResponse.json({ grade: null, feedback: null });
    }

    const saved = await prisma.assignmentProblemGrade.upsert({
      where: {
        assignmentId_problemId_studentId: {
          assignmentId,
          problemId,
          studentId,
        },
      },
      create: {
        assignmentId,
        problemId,
        studentId,
        grade,
        feedback,
      },
      update: {
        grade,
        feedback,
      },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: graderId,
      action: 'PROBLEM_GRADE_UPDATED',
      severity: 'INFO',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        studentId,
        graderId,
        previousGrade: existing?.grade ?? null,
        grade,
        maxPoints: assignmentProblem.maxPoints,
        feedbackChanged: (existing?.feedback ?? null) !== feedback,
      },
    });

    return NextResponse.json({
      grade: saved.grade ?? null,
      feedback: saved.feedback ?? null,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    console.error('POST /api/courses/[id]/[aid]/problems/[pid]/grade/[studentId] error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: graderId,
      action: 'PROBLEM_GRADE_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to save problem grade' }, { status: 500 });
  }
}
