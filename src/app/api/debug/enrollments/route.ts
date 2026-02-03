// Debug endpoint to check user enrollments
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function GET() {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const enrollments = await prisma.roster.findMany({
      where: {
        userId: session.user.id
      },
      include: {
        course: {
          select: {
            id: true,
            name: true,
            code: true,
            isPublished: true
          }
        }
      }
    });

    return NextResponse.json({
      userId: session.user.id,
      userRole: session.user.role,
      enrollments
    });
  } catch (error) {
    console.error('Failed to fetch enrollments:', error);
    return NextResponse.json({ error: 'Failed to fetch enrollments' }, { status: 500 });
  }
}
