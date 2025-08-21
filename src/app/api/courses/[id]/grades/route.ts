import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

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
      include: { user: true },
      orderBy: { createdAt: 'asc' }
    });

  const students = roster.map((r) => ({ id: r.user.id, firstName: r.user.firstName, lastName: r.user.lastName, email: r.user.email, avatar: r.user.avatar }));

    // Get assignments for the course
    const assignments = await prisma.assignment.findMany({ where: { courseId: id }, orderBy: { dueDate: 'asc' } });
    const assignmentIds = assignments.map((a) => a.id);
    const studentIds = students.map((s) => s.id);

    // Fetch all submissions for these students and assignments
    const submissions = await prisma.submission.findMany({
      where: {
        assignmentId: { in: assignmentIds },
        studentId: { in: studentIds },
      },
    });

    // Build nested map: grades[studentId][assignmentId] = totalGrade (sum best per problem)
    const grades: Record<string, Record<string, number | null>> = {};

    // Initialize with nulls
    for (const s of studentIds) {
      grades[s] = {};
      for (const a of assignmentIds) grades[s][a] = null;
    }

    // For each student+assignment, compute best per-problem then sum
    // Group submissions by student+assignment+problem and take max grade
    const bestMap = new Map<string, number>(); // key = `${studentId}|${assignmentId}|${problemId}` -> grade

    submissions.forEach((sub) => {
      const key = `${sub.studentId}|${sub.assignmentId}|${sub.problemId}`;
      const existing = bestMap.get(key);
      if (sub.grade !== null && (existing === undefined || sub.grade > existing)) {
        bestMap.set(key, sub.grade as number);
      }
    });

    // Sum per student-assignment
    for (const [key, grade] of bestMap.entries()) {
      const [studentId, assignmentId] = key.split('|');
      if (grades[studentId] && grades[studentId][assignmentId] !== undefined) {
        const prev = grades[studentId][assignmentId];
        grades[studentId][assignmentId] = (prev || 0) + grade;
      }
    }

    return NextResponse.json({ students, assignments, grades });
  } catch (error) {
    console.error('GET /api/courses/[id]/grades error:', error);
    return NextResponse.json({ error: 'Failed to fetch grades' }, { status: 500 });
  }
}
