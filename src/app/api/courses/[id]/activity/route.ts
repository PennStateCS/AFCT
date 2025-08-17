import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: courseId } = await context.params;
    
    // Verify user has access to this course
    const course = await prisma.course.findFirst({
      where: {
        id: courseId,
        roster: {
          some: {
            userId: session.user.id,
          },
        },
      },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found or access denied' }, { status: 404 });
    }

    // Get URL search params for pagination
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Get activity logs for users in this course - simplified query first
    const courseUserIds = await prisma.roster.findMany({
      where: { courseId },
      select: { userId: true },
    });

    const userIds = courseUserIds.map(r => r.userId);

    // Simple query first to test
    const activityLogs = await prisma.activityLog.findMany({
      where: {
        AND: [
          { userId: { in: userIds } },
          {
            OR: [
              // Course-specific actions
              { action: { contains: 'COURSE' } },
              { action: { contains: 'ASSIGNMENT' } },
              { action: { contains: 'PROBLEM' } },
              { action: { contains: 'SUBMISSION' } },
              { action: { contains: 'GRADE' } },
              // Only recent logins (last 2 hours) to show current activity
              { 
                AND: [
                  { action: { contains: 'LOGIN' } },
                  { 
                    timestamp: {
                      gte: new Date(Date.now() - 2 * 60 * 60 * 1000) // Last 2 hours only
                    }
                  }
                ]
              }
            ]
          }
        ]
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
    });

    // Get total count for pagination
    const totalCount = await prisma.activityLog.count({
      where: {
        AND: [
          { userId: { in: userIds } },
          {
            OR: [
              { action: { contains: 'COURSE' } },
              { action: { contains: 'ASSIGNMENT' } },
              { action: { contains: 'PROBLEM' } },
              { action: { contains: 'SUBMISSION' } },
              { action: { contains: 'GRADE' } },
              { 
                AND: [
                  { action: { contains: 'LOGIN' } },
                  { 
                    timestamp: {
                      gte: new Date(Date.now() - 2 * 60 * 60 * 1000)
                    }
                  }
                ]
              }
            ]
          }
        ]
      },
    });

    return NextResponse.json({
      activities: activityLogs,
      totalCount,
      hasMore: offset + limit < totalCount,
    });
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
