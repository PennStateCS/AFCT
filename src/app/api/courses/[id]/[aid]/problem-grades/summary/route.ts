import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; aid: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: courseId, aid: assignmentId } = await params;
    const isStaff = ['ADMIN', 'FACULTY', 'TA'].includes(session.user.role);
    if (!isStaff) {
      await createEnhancedActivityLog(prisma, _req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_GRADES_SUMMARY_ACCESS_DENIED',
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
}
