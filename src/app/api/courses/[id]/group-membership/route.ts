import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

// GET: find which group a user belongs to in a course
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await params;
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');

  if (!courseId || !userId) {
    return NextResponse.json({ error: 'Missing courseId or userId' }, { status: 400 });
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentUser = session.user;

  try {
    // Authorization: allow if user is querying their own membership, or is course staff/admin
    const isSelf = currentUser.id === userId;
    const isAdmin = currentUser.role === 'ADMIN';
    
    if (!isSelf && !isAdmin) {
      // Check if user is course staff (INSTRUCTOR/FACULTY/TA)
      const currentRoster = await prisma.roster.findFirst({
        where: { courseId, userId: currentUser.id },
      });
      const isCourseStaff = ['INSTRUCTOR', 'FACULTY', 'TA'].includes(currentRoster?.role ?? '');
      
      if (!isCourseStaff) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Find the group membership for this user in this course
    const membership = await prisma.groupRoster.findFirst({
      where: {
        courseId,
        userId,
      },
      select: {
        groupId: true,
      },
    });

    return NextResponse.json({
      groupId: membership?.groupId ?? null,
    });
  } catch (err) {
    console.error('[GROUP_MEMBERSHIP_GET_ERROR]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
