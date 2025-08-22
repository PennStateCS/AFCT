import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const assignmentId = resolvedParams.id;
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    // Verify user is either requesting their own grade or is faculty/admin/TA
    if (userId && userId !== session.user.id && 
        session.user.role !== 'FACULTY' && 
        session.user.role !== 'ADMIN' && 
        session.user.role !== 'TA') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // If no userId specified, use the current user's ID
    const targetUserId = userId || session.user.id;

    // Check for existing AssignmentGrade record
    const assignmentGrade = await prisma.assignmentGrade.findUnique({
      where: {
        assignmentId_studentId: {
          assignmentId,
          studentId: targetUserId,
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
    console.error('Error fetching assignment grade:', error);
    return NextResponse.json(
      { error: 'Failed to fetch assignment grade' },
      { status: 500 }
    );
  }
}
