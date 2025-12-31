// /src/api/courses/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canArchiveCourse, canUnpublishCourse } from '@/lib/course-status-checks';

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

    // Group roster users by role
    const faculty = course.roster.filter((r) => r.role === 'FACULTY').map((r) => r.user);
    const tas = course.roster.filter((r) => r.role === 'TA').map((r) => r.user);
    // For students, compute whether they have any submissions for this course
    const studentRoster = course.roster.filter((r) => r.role === 'STUDENT');
    const students = await Promise.all(
      studentRoster.map(async (r) => {
        const user = r.user;
        // gather assignment ids for this course
        const assignmentIds = course.assignments.map((a) => a.id);
        let hasSubmissions = false;
        if (assignmentIds.length > 0) {
          const found = await prisma.submission.findFirst({
            where: {
              studentId: user.id,
              assignmentId: { in: assignmentIds },
            },
            select: { id: true },
          });
          hasSubmissions = !!found;
        }
        return { ...user, hasSubmissions };
      }),
    );

    // Attach problem counts and safety flags to assignments
    const assignmentsWithProblemCount = await Promise.all(
      course.assignments.map(async (assignment) => {
        // Check for submissions and comments
  const submissionCount = await prisma.submission.count({ where: { assignmentId: assignment.id } });
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
      })
    );

  // Determine whether each problem is linked to any assignment via assignmentProblem
  const problemIds = course.problems.map((p) => p.id);
  const linked = await prisma.assignmentProblem.findMany({ where: { problemId: { in: problemIds } }, select: { problemId: true } });
  const linkedSet = new Set(linked.map((l) => l.problemId));

  const problemsWithLink = course.problems.map((p) => ({ ...p, usedByAssignment: linkedSet.has(p.id) }));

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
  faculty,
  tas,
  students,
  problems: problemsWithLink,
      assignments: assignmentsWithProblemCount,
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

  // Allow only ADMIN or FACULTY to toggle archive status
  if (!user || !['ADMIN', 'FACULTY'].includes(user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Parse request
  const body = await req.json();

  // Centralized check for archiving
  if (body.isArchived) {
    const { canArchive, reason } = await canArchiveCourse(prisma, body.courseId, body.startDate, body.endDate);
    if (!canArchive) {
      return NextResponse.json({ error: reason }, { status: 403 });
    }
  }

  // Centralized check for unpublishing
  if (!body.isPublished) {
    const { canUnpublish, reason } = await canUnpublishCourse(prisma, body.courseId);
    if (!canUnpublish) {
      return NextResponse.json({ error: reason }, { status: 403 });
    }
  }

  try {
    // Update the course
    const updatedCourse = await prisma.course.update({
      where: { id },
      data: {
        name: body.name,
        code: body.code,
        semester: body.semester,
        credits: Number(body.credits),
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        isPublished: body.isPublished,
        isArchived: body.isArchived,
      },
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

    // Group roster users by role
    const faculty = updatedCourse.roster.filter((r) => r.role === 'FACULTY').map((r) => r.user);
    const tas = updatedCourse.roster.filter((r) => r.role === 'TA').map((r) => r.user);
    const students = updatedCourse.roster.filter((r) => r.role === 'STUDENT').map((r) => r.user);

    // Attach problem counts to assignments
    const assignmentsWithProblemCount = await Promise.all(
      updatedCourse.assignments.map(async (assignment) => {
        const submissionCount = await prisma.submission.count({ where: { assignmentId: assignment.id } });
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
      })
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
      faculty,
      tas,
      students,
      problems: updatedCourse.problems,
      assignments: assignmentsWithProblemCount,
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
    select: { isArchived: true }
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
      } 
    });

    // Log the update action to ActivityLog
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'DELETE_COURSE',
      category: 'COURSE',
      metadata: { "courseName": deletedCourse.name },
    });
    return NextResponse.json({ status: 204 });
  } catch (error) {
    console.error('DELETE /api/courses/[id] error:', error);
    return NextResponse.json({ error: error }, { status: 500 });
  }
}