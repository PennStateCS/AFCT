import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

// Local copy of registration code generator to match POST /api/courses behavior
async function generateUniqueCourseCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';

  function randomCode() {
    const part1 = Array.from(
      { length: 3 },
      () => letters[Math.floor(Math.random() * letters.length)],
    ).join('');
    const part2 = Array.from(
      { length: 3 },
      () => numbers[Math.floor(Math.random() * numbers.length)],
    ).join('');
    return `${part1}${part2}`.toUpperCase();
  }

  let code: string;
  let exists = true;

  do {
    code = randomCode();
    const existing = await prisma.course.findUnique({ where: { regCode: code } });
    exists = !!existing;
  } while (exists);

  return code;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await params;
  const courseId = resolved.id;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only allow faculty/admin/ta to duplicate
    const role = session.user.role;
    if (!['FACULTY', 'ADMIN', 'TA'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const {
      title,
      semester,
      startDate,
      endDate,
      credits,
      copyAssignments: bodyCopyAssignments,
      copyProblems: bodyCopyProblems,
      copyMode,
      copyFaculty = false,
      copyTAs = false,
    } = body ?? {};

    // Determine normalized mode: 'assignments' | 'problems' | 'assignments_with_problems'
    let mode: 'assignments' | 'problems' | 'assignments_with_problems' = 'assignments_with_problems';
    if (copyMode) {
      if (copyMode === 'assignments') mode = 'assignments';
      else if (copyMode === 'problems') mode = 'problems';
      else mode = 'assignments_with_problems';
    } else {
      // fallback to legacy booleans
      if (bodyCopyAssignments && bodyCopyProblems) mode = 'assignments_with_problems';
      else if (bodyCopyAssignments) mode = 'assignments';
      else if (bodyCopyProblems) mode = 'problems';
      else mode = 'assignments_with_problems';
    }

    // Validate minimal fields
    if (!title || !semester || !startDate || !endDate) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Convert dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Begin transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create new course (default not published)
      const regCode = await generateUniqueCourseCode();

      const newCourse = await tx.course.create({
        data: {
          name: title,
          code: `${title.slice(0,3).toUpperCase()}-${Date.now().toString().slice(-4)}`,
          semester,
          credits: Number(credits) || 0,
          startDate: start,
          endDate: end,
          isPublished: false,
          regCode,
        },
      });

      // Assign current user as faculty in roster
      await tx.roster.create({
        data: {
          courseId: newCourse.id,
          userId: session.user.id,
          role: 'FACULTY',
        },
      });

      // Optionally copy faculty/TAs from original roster
      if (copyFaculty || copyTAs) {
        const originalRoster = await tx.roster.findMany({ where: { courseId } });
        for (const r of originalRoster) {
          if (r.userId === session.user.id) continue; // already added
          if (r.role === 'FACULTY' && copyFaculty) {
            await tx.roster.create({ data: { courseId: newCourse.id, userId: r.userId, role: 'FACULTY' } });
          }
          if (r.role === 'TA' && copyTAs) {
            await tx.roster.create({ data: { courseId: newCourse.id, userId: r.userId, role: 'TA' } });
          }
        }
      }

      // Fetch original assignments (with their linked problems)
      const originalAssignments = await tx.assignment.findMany({
        where: { courseId },
        include: { problems: { include: { problem: true } } },
      });

      // Map for problem id translation
      const problemIdMap: Record<string, string> = {};

      // Depending on mode, fetch and copy problems:
      if (mode === 'problems') {
        // copy all problems
        const originalProblems = await tx.problem.findMany({ where: { courseId } });
        for (const p of originalProblems) {
          const created = await tx.problem.create({
            data: {
              title: p.title,
              description: p.description ?? undefined,
              fileName: p.fileName ?? undefined,
              originalFileName: p.originalFileName ?? undefined,
              type: p.type ?? undefined,
              maxStates: p.maxStates ?? undefined,
              isDeterministic: p.isDeterministic ?? undefined,
              courseId: newCourse.id,
            },
          });
          problemIdMap[p.id] = created.id;
        }
      } else if (mode === 'assignments_with_problems') {
        // copy only problems that are attached to assignments, and map them
        const neededProblemIds = new Set<string>();
        for (const a of originalAssignments) {
          for (const ap of a.problems) neededProblemIds.add(ap.problemId);
        }
        if (neededProblemIds.size > 0) {
          const problemsToCopy = await tx.problem.findMany({ where: { id: { in: Array.from(neededProblemIds) } } });
          for (const p of problemsToCopy) {
            const created = await tx.problem.create({
              data: {
                title: p.title,
                description: p.description ?? undefined,
                fileName: p.fileName ?? undefined,
                originalFileName: p.originalFileName ?? undefined,
                type: p.type ?? undefined,
                maxStates: p.maxStates ?? undefined,
                isDeterministic: p.isDeterministic ?? undefined,
                courseId: newCourse.id,
              },
            });
            problemIdMap[p.id] = created.id;
          }
        }
      }

      // If mode is 'assignments', we will copy assignments but NOT create any assignmentProblem links.
      if (mode === 'assignments' || mode === 'assignments_with_problems') {
        for (const a of originalAssignments) {
          const createdA = await tx.assignment.create({
            data: {
              title: a.title,
              description: a.description ?? undefined,
              dueDate: a.dueDate,
              maxPoints: a.maxPoints,
              isPublished: false,
              courseId: newCourse.id,
            },
          });

          if (mode === 'assignments_with_problems') {
            // Link copied problems (only) to this new assignment according to original assignment mapping
            for (const ap of a.problems) {
              const oldProblemId = ap.problemId;
              const newProblemId = problemIdMap[oldProblemId];
              if (!newProblemId) continue; // skip if problem wasn't copied for some reason
              await tx.assignmentProblem.create({ data: { assignmentId: createdA.id, problemId: newProblemId } });
            }
          }
        }
      }

      return newCourse;
    });

    return NextResponse.json({ id: result.id, message: 'Course duplicated' }, { status: 201 });
  } catch (err) {
    console.error('Duplicate course error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
