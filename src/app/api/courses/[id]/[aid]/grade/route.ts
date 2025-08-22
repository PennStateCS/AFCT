import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; aid: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const resolved = await params;
    const courseId = resolved.id;
    const assignmentId = resolved.aid;

    // Only course staff may set grades
    if (!['FACULTY', 'TA', 'ADMIN'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const studentId = body?.studentId;
    const grade = body?.grade;

    if (!studentId || typeof grade !== 'number' || Number.isNaN(grade)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Create an activity log entry representing a manual grade override
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: 'GRADE_SET',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId,
        metadata: {
          studentId,
          grade,
          source: 'manual'
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('POST /api/courses/[id]/[aid]/grade error:', error);
    return NextResponse.json({ error: 'Failed to save grade' }, { status: 500 });
  }
}
