import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  // Types
  interface Course {
    courseId: string
  }

  interface AssignmentCourse {
    id: string;
    code: string;
    name: string;
  }

  interface AssignmentWithCourse {
    id: string;
    courseId: string;
    dueDate: string | Date;
    course: AssignmentCourse;
  }

  interface Assignment {
    assignmentId: string;
  }

  interface CourseCount {
    courseId: string;
    _count: { _all: number };
  }

  interface GradeCount {
    assignmentId: string;
    _count: { _all: number };
  }

  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as { start: string; end: string };
    const { start, end } = body;
    if (!start || !end) {
      return NextResponse.json({ error: 'Missing start or end' }, { status: 400 });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);

    // Get course ids the user is enrolled in
    const rosterEntries: Course[] = await prisma.roster.findMany({ where: { userId: session.user.id }, select: { courseId: true } });
    const courseIds = rosterEntries.map(r => r.courseId);

    if (courseIds.length === 0) return NextResponse.json([], { status: 200 });

    const assignments: AssignmentWithCourse[] = await prisma.assignment.findMany({
      where: {
        courseId: { in: courseIds },
        dueDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        course: {
          select: { id: true, code: true, name: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    // Compute crossed-out state per assignment according to rules:
    // - For STUDENT: crossed out if the student has any submissions for the assignment OR has a grade for themselves for that assignment.
    // - For others: crossed out if assignment due date has passed AND every student in the course has a grade for that assignment.
    const assignmentIds = assignments.map(a => a.id);

    if (session.user.role === 'STUDENT') {
      // Find submissions by this student for the assignments
      const studentSubmissions: Assignment[] = await prisma.submission.findMany({
        where: { studentId: session.user.id, assignmentId: { in: assignmentIds } },
        select: { assignmentId: true },
      });
      const submissionSet = new Set(studentSubmissions.map(s => s.assignmentId));

      // Find grades for this student for the assignments
      const studentGrades: Assignment[] = await prisma.assignmentGrade.findMany({
        where: { studentId: session.user.id, assignmentId: { in: assignmentIds } },
        select: { assignmentId: true },
      });
      const gradeSet = new Set(studentGrades.map(g => g.assignmentId));

      const now = new Date();
      const enhanced = assignments.map(a => ({
        ...a,
        crossedOut: submissionSet.has(a.id) || gradeSet.has(a.id),
        studentHasSubmission: submissionSet.has(a.id),
        studentHasGrade: gradeSet.has(a.id),
      }));

      return NextResponse.json(enhanced, { status: 200 });
    }

    // For non-students: determine student counts per course and graded counts per assignment
    const courseIdsSet = Array.from(new Set(assignments.map(a => a.courseId)));

    const studentCounts: CourseCount[]= await prisma.roster.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIdsSet }, role: 'STUDENT' },
      _count: { _all: true },
    }) as unknown as CourseCount[];
    const studentCountByCourse: Record<string, number> = {};
    studentCounts.forEach(c => { studentCountByCourse[c.courseId] = c._count._all; });

    const gradedCounts: GradeCount[] = await prisma.assignmentGrade.groupBy({
      by: ['assignmentId'],
      where: { assignmentId: { in: assignmentIds } },
      _count: { _all: true },
    }) as unknown as GradeCount[];
    const gradedCountByAssignment: Record<string, number> = {};
    gradedCounts.forEach(g => { gradedCountByAssignment[g.assignmentId] = g._count._all; });

    const now = new Date();
    const enhanced = assignments.map(a => {
      const totalStudents = studentCountByCourse[a.courseId] ?? 0;
      const gradedCount = gradedCountByAssignment[a.id] ?? 0;
      const allGraded = totalStudents > 0 && gradedCount >= totalStudents;
      const duePassed = new Date(a.dueDate) < now;
      return {
        ...a,
        crossedOut: duePassed && allGraded,
        totalStudents,
        gradedCount,
        allGraded,
      };
    });

    return NextResponse.json(enhanced, { status: 200 });
  } catch (error) {
    console.error('Error fetching assignment range:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
