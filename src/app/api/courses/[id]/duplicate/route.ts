import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { toDateTimeInTimezone } from '@/lib/date-utils';
import { toEmptyStringNotation } from '@/lib/empty-string-notation';
import type { Prisma } from '@prisma/client';

const courseCodeRegex = /^[A-Z]{2,8}\s?\d{1,4}[A-Z]?$/;
const normalizeCode = (v: string) => v.trim().replace(/\s+/g, ' ').toUpperCase();

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
      code,
      semester,
      startDate,
      endDate,
      registrationOpenAt,
      registrationCloseAt,
      credits,
      emptyStringNotation,
      copyAssignments: bodyCopyAssignments,
      copyProblems: bodyCopyProblems,
      copyMode,
      copyFaculty = false,
      copyTAs = false,
    } = body ?? {};

    const parsedCredits = Number(credits);
    if (!Number.isInteger(parsedCredits) || parsedCredits < 1 || parsedCredits > 6) {
      return NextResponse.json(
        { error: 'Credits must be an integer between 1 and 6.' },
        { status: 400 },
      );
    }

    // Determine normalized mode: 'assignments' | 'problems' | 'assignments_with_problems'
    let mode: 'assignments' | 'problems' | 'assignments_with_problems' =
      'assignments_with_problems';
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
    if (
      !title ||
      !semester ||
      !startDate ||
      !endDate ||
      !registrationOpenAt ||
      !registrationCloseAt
    ) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (typeof code !== 'string' || !courseCodeRegex.test(normalizeCode(code))) {
      return NextResponse.json(
        { error: 'Use a code like "CMPSC 221" or "MATH220".' },
        { status: 400 },
      );
    }

    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);
    const parsedRegistrationOpenAt = new Date(registrationOpenAt);
    const parsedRegistrationCloseAt = new Date(registrationCloseAt);

    if (
      [parsedStartDate, parsedEndDate, parsedRegistrationOpenAt, parsedRegistrationCloseAt].some(
        (d) => Number.isNaN(d.getTime()),
      )
    ) {
      return NextResponse.json({ error: 'Invalid date/time value.' }, { status: 400 });
    }

    if (parsedStartDate > parsedEndDate) {
      return NextResponse.json(
        { error: 'Start date/time must be on or before the end date/time.' },
        { status: 400 },
      );
    }

    if (parsedRegistrationOpenAt > parsedRegistrationCloseAt) {
      return NextResponse.json(
        { error: 'Self registration open must be on or before the close date.' },
        { status: 400 },
      );
    }

    // Get user's timezone (DB user > system settings > default)
    let userTimezone = 'America/New_York';
    if (session.user?.id) {
      const userRecord = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { timezone: true },
      });
      if (userRecord?.timezone) {
        userTimezone = userRecord.timezone;
      } else {
        const system = await prisma.systemSettings.findUnique({ where: { id: 1 } });
        userTimezone = system?.timezone || userTimezone;
      }
    }

    // Begin transaction
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create new course (default not published)
      const regCode = await generateUniqueCourseCode();

      const newCourse = await tx.course.create({
        data: {
          name: title,
          code: normalizeCode(code),
          semester,
          credits: parsedCredits,
          startDate: toDateTimeInTimezone(startDate, userTimezone),
          endDate: toDateTimeInTimezone(endDate, userTimezone),
          registrationOpenAt: toDateTimeInTimezone(registrationOpenAt, userTimezone),
          registrationCloseAt: toDateTimeInTimezone(registrationCloseAt, userTimezone),
          isPublished: false,
          isArchived: false,
          emptyStringNotation: toEmptyStringNotation(emptyStringNotation),
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
          if (((r.role as string) === 'FACULTY' || (r.role as string) === 'ADMIN') && copyFaculty) {
            await tx.roster.create({
              data: { courseId: newCourse.id, userId: r.userId, role: r.role },
            });
          }
          if (r.role === 'TA' && copyTAs) {
            await tx.roster.create({
              data: { courseId: newCourse.id, userId: r.userId, role: r.role },
            });
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
          const problemsToCopy = await tx.problem.findMany({
            where: { id: { in: Array.from(neededProblemIds) } },
          });
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
              await tx.assignmentProblem.create({
                data: { assignmentId: createdA.id, problemId: newProblemId },
              });
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
