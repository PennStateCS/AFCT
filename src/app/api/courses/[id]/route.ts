import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
            role: true, // include roster role
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: true,
                email: true,
              },
            },
          },
        },
        problems: true,
        assignments: {
          include: {
            _count: {
              select: { problems: true }, // problem count from AssignmentProblem
            },
          },
        },
      },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Separate faculty, TAs, students based on roster.role
    const faculty = course.roster.filter((r) => r.role === 'FACULTY').map((r) => r.user);
    const tas = course.roster.filter((r) => r.role === 'TA').map((r) => r.user);
    const students = course.roster.filter((r) => r.role === 'STUDENT').map((r) => r.user);

    // Add problemCount to assignments
    const assignmentsWithProblemCount = course.assignments.map((assignment) => ({
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
    }));

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
      createdAt: course.createdAt,
      updatedAt: course.updatedAt,
      faculty,
      tas,
      students,
      problems: course.problems,
      assignments: assignmentsWithProblemCount,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await req.json();

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  try {
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
              },
            },
          },
        },
      },
    });

    const faculty = updatedCourse.roster.filter((r) => r.role === 'FACULTY').map((r) => r.user);
    const tas = updatedCourse.roster.filter((r) => r.role === 'TA').map((r) => r.user);
    const students = updatedCourse.roster.filter((r) => r.role === 'STUDENT').map((r) => r.user);

    const assignmentsWithProblemCount = updatedCourse.assignments.map((assignment) => ({
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
    }));

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
