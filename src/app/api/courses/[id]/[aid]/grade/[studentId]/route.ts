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

  // Check for existing AssignmentGrade record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignmentGrade = await (prisma as any).assignmentGrade.findUnique({
      where: {
        assignmentId_studentId: {
          assignmentId,
          studentId,
        },
      },
    });

    if (assignmentGrade) {
      return NextResponse.json({ 
        grade: assignmentGrade.grade,
        feedback: assignmentGrade.feedback,
        updatedAt: assignmentGrade.updatedAt 
      });
    }

    // No grade assigned yet
    return NextResponse.json({ grade: null });
  } catch (error) {
    console.error('GET /api/courses/[id]/[aid]/grade/[studentId] error:', error);
    return NextResponse.json({ error: 'Failed to fetch grade' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; aid: string; studentId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Only allow staff to set grades
    if (!['FACULTY', 'TA', 'ADMIN'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const resolved = await params;
    const assignmentId = resolved.aid;
    const studentId = resolved.studentId;

    const { grade, feedback } = await req.json();

    // Validate grade: must be null (to clear) or a number between 0 and the max grade possible
    if (grade !== null && (typeof grade !== 'number' || grade < 0 || grade > 100)) {
      return NextResponse.json({ error: 'Invalid grade value' }, { status: 400 });
    }

    // Upsert the assignment grade
    if (grade === null) {
      // Delete the grade if setting to null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any).assignmentGrade.deleteMany({
        where: {
          assignmentId,
          studentId,
        },
      });
      return NextResponse.json({ grade: null, feedback: null });
    } else {
      // Create or update the grade
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignmentGrade = await (prisma as any).assignmentGrade.upsert({
        where: {
          assignmentId_studentId: {
            assignmentId,
            studentId,
          },
        },
        create: {
          assignmentId,
          studentId,
          grade,
          feedback: feedback || null,
        },
        update: {
          grade,
          feedback: feedback || null,
        },
      });

      return NextResponse.json({ 
        grade: assignmentGrade.grade,
        feedback: assignmentGrade.feedback,
        updatedAt: assignmentGrade.updatedAt 
      });
    }
  } catch (error) {
    console.error('POST /api/courses/[id]/[aid]/grade/[studentId] error:', error);
    return NextResponse.json({ error: 'Failed to set grade' }, { status: 500 });
  }
}
