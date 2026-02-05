// /src/api/courses/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canArchiveCourse, canUnpublishCourse } from '@/lib/course-status-checks';
import { toDateTimeInTimezone } from '@/lib/date-utils';

// GET: Fetch a course by ID with full metadata
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  try {
    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        roster: {
          select: {
            role: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: true,
                email: true,
                avatar: true,
              },
            },
          },
        },
        problems: true,
        assignments: {
          include: {
            _count: {
              select: { problems: true },
            },
          },
        },
      },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Build a single enrolled array (user objects plus courseRole), and compute student submission flags as needed.
    const enrolled = await Promise.all(
      course.roster.map(async (r: (typeof course.roster)[number]) => {
        const user = r.user;
        const courseRole = r.role;

        // For students only, compute hasSubmissions flag
        let hasSubmissions = false;
        if (courseRole === 'STUDENT') {
          const assignmentIds = course.assignments.map(
            (a: (typeof course.assignments)[number]) => a.id,
          );
          if (assignmentIds.length > 0) {
            const found = await prisma.submission.findFirst({
              where: { studentId: user.id, assignmentId: { in: assignmentIds } },
              select: { id: true },
            });
            hasSubmissions = !!found;
          }
        }

        return { ...user, courseRole, hasSubmissions };
      }),
    );

    // Attach problem counts and safety flags to assignments
    const assignmentsWithProblemCount = await Promise.all(
      course.assignments.map(async (assignment: (typeof course.assignments)[number]) => {
        // Check for submissions and comments
        const submissionCount = await prisma.submission.count({
          where: { assignmentId: assignment.id },
        });
        const commentCount = await prisma.comment.count({ where: { assignmentId: assignment.id } });
        const hasSubmissionsOrComments = submissionCount > 0 || commentCount > 0;

        return {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          dueDate: assignment.dueDate,
          maxPoints: assignment.maxPoints,
          isPublished: assignment.isPublished,
          createdAt: assignment.createdAt,
          updatedAt: assignment.updatedAt,
          courseId: assignment.courseId,
          problemCount: assignment._count.problems,
          submissionCount,
          commentCount,
          hasSubmissionsOrComments,
        };
      }),
    );

    // Determine whether each problem is linked to any assignment via assignmentProblem
    const problemIds = course.problems.map((p: (typeof course.problems)[number]) => p.id);
    const linked = await prisma.assignmentProblem.findMany({
      where: { problemId: { in: problemIds } },
      select: { problemId: true },
    });
    const linkedSet = new Set(linked.map((l: (typeof linked)[number]) => l.problemId));

    const problemsWithLink = course.problems.map((p: (typeof course.problems)[number]) => ({
      ...p,
      usedByAssignment: linkedSet.has(p.id),
    }));

    // Determine viewer's course role if authenticated
    const session = await auth();
    let viewerRole: string | null = null;
    let viewerDefaultRole: string | null = null;
    if (session?.user) {
      const viewerRoster = await prisma.roster.findFirst({
        where: { courseId: course.id, userId: session.user.id },
        select: { role: true },
      });
      viewerRole = viewerRoster?.role ?? null;
      viewerDefaultRole = session.user.role ?? null;
    }

    return NextResponse.json({
      id: course.id,
      name: course.name,
      code: course.code,
      regCode: course.regCode,
      semester: course.semester,
      credits: course.credits,
      startDate: course.startDate,
      endDate: course.endDate,
      isPublished: course.isPublished,
      isArchived: course.isArchived,
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      // Only include a single enrolled array (user objects with courseRole)
      enrolled,
      problems: problemsWithLink,
      assignments: assignmentsWithProblemCount,
      viewerRole,
      viewerDefaultRole,
    });
  } catch (error) {
    console.error('GET /api/courses/[id] error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT: Update a course (Faculty/Admin/TA only)
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  // Get authenticated user session
  const session = await auth();
  const user = session?.user;

  // Allow only ADMIN, FACULTY, or TA to edit courses
  if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Parse request
  const body = await req.json();

  // Get user's timezone (DB user > system settings > default)
  let userTimezone = 'America/New_York';
  if (user?.id) {
    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: { timezone: true },
    });
    if (userRecord?.timezone) {
      userTimezone = userRecord.timezone;
    } else {
      const system = await prisma.systemSettings.findUnique({ where: { id: 1 } });
      userTimezone = system?.timezone || userTimezone;
    }
  }

  // Validate input
  if (typeof body.isArchived !== 'boolean') {
    return NextResponse.json({ error: 'isArchived must be a boolean' }, { status: 400 });
  }

  // Centralized check for archiving
  if (body.isArchived) {
    const { canArchive, reason } = await canArchiveCourse(prisma, id, body.startDate, body.endDate);
    if (!canArchive) {
      return NextResponse.json({ error: reason }, { status: 403 });
    }
  }

  // Centralized check for unpublishing
  if (!body.isPublished) {
    const { canUnpublish, reason } = await canUnpublishCourse(prisma, id);
    if (!canUnpublish) {
      return NextResponse.json({ error: reason }, { status: 403 });
    }
  }

  try {
    const instructorIds = Array.isArray(body.instructorIds) ? body.instructorIds : null;
    if (Array.isArray(instructorIds) && instructorIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one faculty member is required.' },
        { status: 400 },
      );
    }

    // Update the course and optionally sync faculty (ADMIN) roster entries
    const updatedCourse = await prisma.$transaction(async (tx) => {
      await tx.course.update({
        where: { id },
        data: {
          name: body.name,
          code: body.code,
          semester: body.semester,
          credits: Number(body.credits),
          startDate: toDateTimeInTimezone(body.startDate, userTimezone),
          endDate: toDateTimeInTimezone(body.endDate, userTimezone),
          isPublished: body.isPublished,
          isArchived: body.isArchived,
        },
      });

      if (instructorIds) {
        const existingFaculty = await tx.roster.findMany({
          where: { courseId: id, role: 'FACULTY' },
          select: { userId: true },
        });
        const existingFacultyIds = new Set(existingFaculty.map((r) => r.userId));
        const desiredFacultyIds = new Set(instructorIds);

        const toAdd = instructorIds.filter((userId: string) => !existingFacultyIds.has(userId));
        const toRemove = Array.from(existingFacultyIds).filter(
          (userId) => !desiredFacultyIds.has(userId),
        );

        if (toRemove.length > 0) {
          await tx.roster.deleteMany({
            where: { courseId: id, role: 'FACULTY', userId: { in: toRemove } },
          });
        }

        if (toAdd.length > 0) {
          await tx.roster.createMany({
            data: toAdd.map((userId: string) => ({
              userId,
              courseId: id,
              role: 'FACULTY',
            })),
          });
        }
      }

      const refreshed = await tx.course.findUnique({
        where: { id },
        include: {
          problems: true,
          assignments: {
            include: {
              _count: {
                select: { problems: true },
              },
            },
          },
          roster: {
            select: {
              role: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  role: true,
                  email: true,
                  avatar: true,
                },
              },
            },
          },
        },
      });

      if (!refreshed) {
        throw new Error('Course not found after update');
      }

      return refreshed;
    });

    // Group roster users by role (include ADMIN alongside FACULTY)
    const instructors = updatedCourse.roster
      .filter((r: (typeof updatedCourse.roster)[number]) => (r.role as string) === 'ADMIN')
      .map((r: (typeof updatedCourse.roster)[number]) => ({ ...r.user, role: r.role }));
    const faculty = updatedCourse.roster
      .filter(
        (r: (typeof updatedCourse.roster)[number]) =>
          (r.role as string) === 'FACULTY' || (r.role as string) === 'ADMIN',
      )
      .map((r: (typeof updatedCourse.roster)[number]) => ({ ...r.user, role: r.role }));
    const tas = updatedCourse.roster
      .filter((r: (typeof updatedCourse.roster)[number]) => r.role === 'TA')
      .map((r: (typeof updatedCourse.roster)[number]) => ({ ...r.user, role: r.role }));
    const students = updatedCourse.roster
      .filter((r: (typeof updatedCourse.roster)[number]) => r.role === 'STUDENT')
      .map((r: (typeof updatedCourse.roster)[number]) => ({ ...r.user, role: r.role }));

    // Attach problem counts to assignments
    const assignmentsWithProblemCount = await Promise.all(
      updatedCourse.assignments.map(
        async (assignment: (typeof updatedCourse.assignments)[number]) => {
          const submissionCount = await prisma.submission.count({
            where: { assignmentId: assignment.id },
          });
          const commentCount = await prisma.comment.count({
            where: { assignmentId: assignment.id },
          });
          const hasSubmissionsOrComments = submissionCount > 0 || commentCount > 0;

          return {
            id: assignment.id,
            title: assignment.title,
            description: assignment.description,
            dueDate: assignment.dueDate,
            maxPoints: assignment.maxPoints,
            isPublished: assignment.isPublished,
            createdAt: assignment.createdAt,
            updatedAt: assignment.updatedAt,
            courseId: assignment.courseId,
            problemCount: assignment._count.problems,
            submissionCount,
            commentCount,
            hasSubmissionsOrComments,
          };
        },
      ),
    );

    // Log the update action to ActivityLog
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'UPDATE_COURSE',
      category: 'COURSE',
      courseId: updatedCourse.id,
      metadata: {
        userId: user.id,
        courseId: updatedCourse.id,
        updatedFields: Object.keys(body),
      },
    });

    // Determine viewer's course role if authenticated
    const session = await auth();
    let viewerRole: string | null = null;
    let viewerDefaultRole: string | null = null;
    if (session?.user) {
      const viewerRoster = await prisma.roster.findFirst({
        where: { courseId: updatedCourse.id, userId: session.user.id },
        select: { role: true },
      });
      viewerRole = viewerRoster?.role ?? null;
      viewerDefaultRole = session.user.role ?? null;
    }

    return NextResponse.json({
      id: updatedCourse.id,
      name: updatedCourse.name,
      code: updatedCourse.code,
      regCode: updatedCourse.regCode,
      semester: updatedCourse.semester,
      credits: updatedCourse.credits,
      startDate: updatedCourse.startDate,
      endDate: updatedCourse.endDate,
      isPublished: updatedCourse.isPublished,
      isArchived: updatedCourse.isArchived,
      createdAt: updatedCourse.createdAt,
      updatedAt: updatedCourse.updatedAt,
      // Only include a single enrolled array (user objects with courseRole)
      enrolled: updatedCourse.roster.map((r: (typeof updatedCourse.roster)[number]) => ({
        ...r.user,
        courseRole: r.role,
      })),
      problems: updatedCourse.problems,
      assignments: assignmentsWithProblemCount,
      viewerRole,
      viewerDefaultRole,
    });
  } catch (error) {
    console.error('PUT /api/courses/[id] error:', error);
    return NextResponse.json({ error: 'Failed to update course' }, { status: 500 });
  }
}

// DELETE: Delete a course (Faculty/Admin/TA only, course must be archived)
export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  // Get authenticated user session
  const session = await auth();
  const user = session?.user;

  if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Make sure the course isArchived
  const courseIsArchived = await prisma.course.findFirst({
    where: { id },
    select: { isArchived: true },
  });

  if (courseIsArchived === null || courseIsArchived.isArchived === false) {
    return NextResponse.json({ error: 'Course must be archived' }, { status: 403 });
  }

  const body = await req.json();

  try {
    // Deleting course code
    const deletedCourse = await prisma.course.delete({
      where: {
        id,
        isArchived: true,
      },
    });

    // Log the update action to ActivityLog
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'DELETE_COURSE',
      category: 'COURSE',
      metadata: { courseName: deletedCourse.name },
    });
    return NextResponse.json({ status: 204 });
  } catch (error) {
    console.error('DELETE /api/courses/[id] error:', error);
    return NextResponse.json({ error: error }, { status: 500 });
  }
}
