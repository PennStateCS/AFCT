import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: courseId } = await context.params;

    const course = await prisma.course.findFirst({
      where: { id: courseId },
      select: { id: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    const role = session.user.role;
    const isPrivileged = role ? ['ADMIN', 'FACULTY', 'TA'].includes(role) : true;
    if (!isPrivileged) {
      const rosterEntry = await prisma.roster.findFirst({
        where: {
          courseId,
          userId: session.user.id,
        },
        select: { id: true },
      });

      if (!rosterEntry) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // Get URL search params for pagination
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Get activities for this specific course using enhanced ActivityLog schema
    const activityLogs = await prisma.activityLog.findMany({
      where: {
        OR: [
          // Direct course activities (most efficient with foreign key)
          { courseId: courseId },
          // Assignment activities in this course
          {
            assignment: { courseId: courseId },
          },
          // Problem activities in this course
          {
            problem: { courseId: courseId },
          },
          // Submission activities for assignments in this course
          {
            submission: {
              assignmentProblem: {
                assignment: { courseId: courseId },
              },
            },
          },
          // Login activities from course members (last 24 hours for better context)
          {
            AND: [
              { action: { contains: 'LOGIN' } },
              {
                timestamp: {
                  gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
                },
              },
              {
                user: {
                  rosterEntries: {
                    some: { courseId: courseId },
                  },
                },
              },
            ],
          },
        ],
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
        course: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        assignment: {
          select: {
            id: true,
            title: true,
          },
        },
        problem: {
          select: {
            id: true,
            title: true,
          },
        },
        submission: {
          select: {
            id: true,
            assignmentProblem: {
              select: {
                assignment: {
                  select: {
                    title: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
    });

    // Get total count for pagination using the same course-specific filter
    const totalCount = await prisma.activityLog.count({
      where: {
        OR: [
          { courseId: courseId },
          {
            assignment: { courseId: courseId },
          },
          {
            problem: { courseId: courseId },
          },
          {
            submission: {
              assignmentProblem: {
                assignment: { courseId: courseId },
              },
            },
          },
          {
            AND: [
              { action: { contains: 'LOGIN' } },
              {
                timestamp: {
                  gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
                },
              },
              {
                user: {
                  rosterEntries: {
                    some: { courseId: courseId },
                  },
                },
              },
            ],
          },
        ],
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
