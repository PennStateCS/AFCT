import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_: Request, context: { params: Promise<{ id: string; aid: string }> }) {
  const { id: courseId, aid: assignmentId } = await context.params;

  try {
    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, courseId },
      include: {
        problems: {
          include: { problem: true }, // AssignmentProblem -> Problem
        },
        course: {
          include: {
            roster: {
              include: {
                user: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }

    // Extract Problems
    const problems = assignment.problems.map((ap) => ({
      id: ap.problem.id,
      title: ap.problem.title,
      description: ap.problem.description,
      type: ap.problem.type,
      maxStates: ap.problem.maxStates,
      isDeterministic: ap.problem.isDeterministic,
      originalFileName: ap.problem.originalFileName,
    }));

    // Split roster by role
    const roster = assignment.course.roster || [];
    const faculty = roster.filter((r) => r.role === 'FACULTY').map((r) => r.user);
    const tas = roster.filter((r) => r.role === 'TA').map((r) => r.user);
    const students = roster.filter((r) => r.role === 'STUDENT').map((r) => r.user);

    const { problems: _problems, course, ...assignmentData } = assignment;

    return NextResponse.json({
      ...assignmentData,
      problems,
      course: {
        id: courseId,
        name: course.name,
        code: course.code,
        faculty: faculty || [],
        tas: tas || [],
        students: students || [],
      },
    });
  } catch (error) {
    console.error('Failed to fetch assignment:', error);
    return NextResponse.json({ error: 'Failed to fetch assignment.' }, { status: 500 });
  }
}
