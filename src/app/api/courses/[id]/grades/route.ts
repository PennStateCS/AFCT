import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
// Route handler for course grades

// Records a gradebook export. The CSV is built and downloaded client-side, so the
// client pings this endpoint (fire-and-forget) so the export is captured in the audit log.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  let actorId: string | null = null;
  try {
    const session = await auth();
    actorId = session?.user?.id ?? null;
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'GRADES_EXPORT_DENIED',
        severity: 'SECURITY',
        courseId: id,
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const platform = typeof body?.platform === 'string' ? body.platform : 'unknown';
    const wholeGradebook = body?.wholeGradebook === true;
    const assignmentCount = Number.isFinite(Number(body?.assignmentCount))
      ? Number(body.assignmentCount)
      : 0;
    const studentCount = Number.isFinite(Number(body?.studentCount)) ? Number(body.studentCount) : 0;

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'GRADES_EXPORTED',
      severity: 'INFO',
      category: 'SUBMISSION',
      courseId: id,
      metadata: {
        userId: session.user.id,
        courseId: id,
        platform,
        wholeGradebook,
        assignmentCount,
        studentCount,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/courses/[id]/grades (export log) error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'GRADES_EXPORT_ERROR',
      severity: 'ERROR',
      courseId: id,
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to record export' }, { status: 500 });
  }
}

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
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'COURSE_GRADES_ACCESS_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
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
