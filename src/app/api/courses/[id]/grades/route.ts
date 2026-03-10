import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
// Route handler for course grades

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only allow faculty/ta/admin to fetch full grade matrix
  if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Get students in the course
    const roster = await prisma.roster.findMany({
      where: { courseId: id, role: 'STUDENT' },
      select: {
        userId: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const rosterUserIds = roster.map((r) => r.userId);

    const users = rosterUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: rosterUserIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
          },
        })
      : [];

    const userMap = new Map(users.map((u) => [u.id, u]));
    const students = rosterUserIds
      .map((userId) => userMap.get(userId))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        avatar: u.avatar,
      }));

    // Get assignments for the course
    const assignmentRows = await prisma.assignment.findMany({
      where: { courseId: id },
      select: {
        id: true,
        title: true,
        dueDate: true,
        problems: {
          select: {
            maxPoints: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });
    const assignments = assignmentRows.map((a) => ({
      id: a.id,
      title: a.title,
      dueDate: a.dueDate,
      maxPoints: a.problems.reduce((sum, p) => sum + Number(p.maxPoints ?? 0), 0),
    }));
    const assignmentIds = assignments.map((a: (typeof assignments)[number]) => a.id);
    const studentIds = students.map((s: (typeof students)[number]) => s.id);

    // Build nested map: grades[studentId][assignmentId] = grade
    const grades: Record<string, Record<string, number | null>> = {};

    // Initialize with nulls
    for (const s of studentIds) {
      grades[s] = {};
      for (const a of assignmentIds) grades[s][a] = null;
    }

    if (assignmentIds.length === 0 || studentIds.length === 0) {
      return NextResponse.json({ students, assignments, grades });
    }

    // Fetch summed grades for each student/assignment pair. Using groupBy
    // collapses individual problem grades into one assignment total.
    const gradeRows = await prisma.assignmentProblemGrade.groupBy({
      by: ['studentId', 'assignmentId'],
      where: {
        assignmentId: { in: assignmentIds },
        studentId: { in: studentIds },
      },
      _sum: { grade: true },
    });

    // Populate with actual grades
    gradeRows.forEach((g) => {
      const sum = g._sum.grade ?? 0;
      if (grades[g.studentId]) {
        grades[g.studentId][g.assignmentId] = sum;
      }
    });

    return NextResponse.json({ students, assignments, grades });
  } catch (error) {
    console.error('GET /api/courses/[id]/grades error:', error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: 'Failed to fetch grades',
        detail: process.env.NODE_ENV === 'development' ? detail : undefined,
      },
      { status: 500 },
    );
  }
}
