// /src/api/courses/[id]/[aid]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET: Fetch a specific assignment and related data within a course
export async function GET(_: Request, context: { params: Promise<{ id: string; aid: string }> }) {
  // Destructure courseId and assignmentId from the dynamic route parameters
  const { id: courseId, aid: assignmentId } = await context.params;

  try {
    // Query the assignment from the database
    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        courseId, // Ensure the assignment belongs to the specified course
      },
      include: {
        problems: {
          include: {
            problem: true, // Join AssignmentProblem → Problem
          },
        },
        course: {
          include: {
            roster: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Return 404 if no matching assignment was found
    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
    }

    // Map and clean up problem details from AssignmentProblem
    const problems = assignment.problems.map((ap) => ({
      id: ap.problem.id,
      title: ap.problem.title,
      description: ap.problem.description,
      type: ap.problem.type,
      maxStates: ap.problem.maxStates,
      isDeterministic: ap.problem.isDeterministic,
      originalFileName: ap.problem.originalFileName,
    }));

    // Extract the course roster and split by role
    const roster = assignment.course.roster || [];

    const faculty = roster.filter((r) => r.role === 'FACULTY').map((r) => r.user);

    const tas = roster.filter((r) => r.role === 'TA').map((r) => r.user);

    const students = roster.filter((r) => r.role === 'STUDENT').map((r) => r.user);

    // Remove joined fields to avoid duplication in the response
    const { problems: _problems, course, ...assignmentData } = assignment;

    // Return structured assignment + course + role-separated roster
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
    // Handle unexpected errors
    console.error('Failed to fetch assignment:', error);
    return NextResponse.json({ error: 'Failed to fetch assignment.' }, { status: 500 });
  }
}
