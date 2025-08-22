import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; aid: string; studentId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const resolved = await params;
  const assignmentId = resolved.aid;
    const studentId = resolved.studentId;

    // Only allow viewing if requesting self or staff
    if (session.user.id !== studentId && !['FACULTY', 'TA', 'ADMIN'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Check for latest manual grade override in activity logs
    // Find recent manual grade overrides for this assignment and filter by metadata.studentId
    const recent = await prisma.activityLog.findMany({
      where: { assignmentId, action: 'GRADE_SET' },
      orderBy: { timestamp: 'desc' },
      take: 20,
    });

    type ManualMeta = { studentId?: string; grade?: number; source?: string };
    const manual = recent.find((r) => {
      if (!r.metadata || typeof r.metadata !== 'object') return false;
      const m = r.metadata as ManualMeta;
      return m.studentId === studentId;
    });

    if (manual && manual.metadata && typeof manual.metadata === 'object') {
      const m = manual.metadata as ManualMeta;
      if (m.grade !== undefined) return NextResponse.json({ grade: m.grade });
    }

    // Fallback: compute total from submissions (reuse assignments grade logic)
    const submissions = await prisma.submission.findMany({
      where: {
        studentId,
        assignmentId,
      },
    });

    const problemGrades = new Map<string, number>();
    submissions.forEach(submission => {
      if (submission.grade !== null) {
        const currentGrade = problemGrades.get(submission.problemId) || 0;
        if (submission.grade > currentGrade) {
          problemGrades.set(submission.problemId, submission.grade);
        }
      }
    });

    const totalGrade = Array.from(problemGrades.values()).reduce((sum, g) => sum + g, 0);

    return NextResponse.json({ grade: totalGrade > 0 ? totalGrade : null, problemGrades: Object.fromEntries(problemGrades) });
  } catch (error) {
    console.error('GET /api/courses/[id]/[aid]/grade/[studentId] error:', error);
    return NextResponse.json({ error: 'Failed to fetch grade' }, { status: 500 });
  }
}
