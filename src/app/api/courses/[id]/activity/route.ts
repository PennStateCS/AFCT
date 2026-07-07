import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canAccessCourse } from '@/lib/permissions';

/**
 * Returns a paginated activity feed for one course — logs tied directly to the
 * course plus its assignments, problems, submissions, and recent logins by course
 * members. Staff (ADMIN/FACULTY/TA) may view any course; everyone else must be on
 * the roster.
 * @openapi
 * summary: Get a course's activity feed
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: limit, in: query, schema: { type: integer, default: 50 } }
 *   - { name: offset, in: query, schema: { type: integer, default: 0 } }
 * responses:
 *   200:
 *     description: A page of activity entries with a total count.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             activities: { type: array, items: { type: object } }
 *             totalCount: { type: integer }
 *             hasMore: { type: boolean }
 *   401: { description: Not signed in. }
 *   403: { description: Not enrolled and not staff. }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
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

    if (!(await canAccessCourse(session.user, courseId))) {
      await createEnhancedActivityLog(prisma, request, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_ACTIVITY_ACCESS_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
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
