/**
 * Courses API (collection)
 *
 * Responsibilities:
 * - GET: return all courses with roster and assignment metadata for dashboard use
 * - POST: create a new course, ensure unique registration code, and seed faculty roster
 *
 * Notes:
 * - Dates are stored in UTC based on the user's effective timezone.
 * - This route uses Prisma transactions to keep course + roster creation consistent.
 * - Keep response shapes stable for UI consumers.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validationResponse } from '@/lib/zod-error';
import { auth } from '@/lib/auth';
import { toDateTimeInTimezone } from '@/lib/date-utils';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { toEmptyStringNotation } from '@/lib/empty-string-notation';
import type { Prisma } from '@prisma/client';

/**
 * Roster item shape used by this route (kept in sync with `include` below).
 * Prefer a Prisma payload type so it scales with schema changes.
 */
type RosterItem = Prisma.RosterGetPayload<{
  include: {
    user: { select: { id: true; firstName: true; lastName: true; role: true } };
  };
}>;

// ----------------------------------------
// Utilities
// ----------------------------------------
/**
 * Generate a unique course registration code in the format `ABC123`.
 * Retries until no collision exists in the database.
 */
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

// ----------------------------------------
// GET /api/courses
// ----------------------------------------
/**
 * Returns all courses ordered by creation date.
 * Includes roster users (id/name/role) and assignment/problem metadata.
 */
export async function GET() {
  try {
    const courses = await prisma.course.findMany({
      include: {
        roster: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        },
        assignments: {
          include: {
            problems: {
              select: { maxPoints: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group roster by role (treat course admins like faculty for display and permissions)
    const formatted = courses.map((c: (typeof courses)[number]) => {
      // Build single `enrolled` list (user objects with courseRole). Do not construct role-specific arrays here.
      const enrolled = c.roster.map((r: (typeof c.roster)[number]) => ({
        ...r.user,
        courseRole: r.role,
      }));

      const assignmentsWithDerivedPoints = c.assignments.map((assignment) => {
        const totalProblemPoints = (assignment.problems ?? []).reduce((sum, ap) => {
          const value = typeof ap.maxPoints === 'number' ? ap.maxPoints : 0;
          return sum + (Number.isFinite(value) ? value : 0);
        }, 0);

        const { problems, ...restAssignment } = assignment;
        return {
          ...restAssignment,
          maxPoints: totalProblemPoints,
          problemCount: problems?.length ?? 0,
        };
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { roster, assignments, ...rest } = c;
      return { ...rest, enrolled, assignments: assignmentsWithDerivedPoints };
    });

    return NextResponse.json(formatted, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch courses:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

// ----------------------------------------
// POST /api/courses
// ----------------------------------------
/**
 * Creates a course and seeds roster faculty entries.
 *
 * Expected payload (validated upstream):
 * - name, code, semester, credits
 * - startDate, endDate (datetime-local strings)
 * - isPublished (optional)
 * - facultyIds (optional)
 */
export async function POST(req: Request) {
  try {
    // 1) Parse payload of information
    const json = await req.json();

    // 2) Ensure user is authorized to create courses
    const session = await auth();
    const role = session?.user?.role;
    if (!role || !['ADMIN', 'TA', 'FACULTY'].includes(role)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    // 3) Get user's timezone (DB user > system settings > default)
    let userTimezone = 'America/New_York';
    if (session?.user?.id) {
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

    if (!json.registrationOpenAt || !json.registrationCloseAt) {
      return NextResponse.json({ message: 'Registration window is required.' }, { status: 400 });
    }

    // 4) Optional uniqueness check (code + semester)
    const exists = await prisma.course.findFirst({
      where: { code: json.code, semester: json.semester },
      select: { id: true },
    });
    if (exists) {
      return NextResponse.json(
        { message: 'A course with that code and semester already exists.' },
        { status: 409 },
      );
    }

    // 5) Generate a unique registration code
    const regCode = await generateUniqueCourseCode();

    // 6) Create course (and roster rows for faculty) in a transaction for consistency
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const course = await tx.course.create({
        data: {
          name: json.name,
          code: json.code,
          regCode,
          semester: json.semester,
          credits: json.credits,
          startDate: toDateTimeInTimezone(json.startDate, userTimezone),
          endDate: toDateTimeInTimezone(json.endDate, userTimezone),
          registrationOpenAt: json.registrationOpenAt
            ? toDateTimeInTimezone(json.registrationOpenAt, userTimezone)
            : null,
          registrationCloseAt: json.registrationCloseAt
            ? toDateTimeInTimezone(json.registrationCloseAt, userTimezone)
            : null,
          isPublished: json.isPublished ?? false,
          isArchived: false,
          emptyStringNotation: toEmptyStringNotation(json.emptyStringNotation),
        },
      });

      const instructorIds = Array.isArray(json.instructorIds) ? json.instructorIds : [];
      const facultyIds = Array.isArray(json.facultyIds) ? json.facultyIds : [];

      if (instructorIds.length > 0) {
        await tx.roster.createMany({
          data: instructorIds.map((userId: string) => ({
            userId,
            courseId: course.id,
            role: 'FACULTY',
          })),
        });
      }

      const facultyOnlyIds = facultyIds.filter((id: string) => !instructorIds.includes(id));
      if (facultyOnlyIds.length > 0) {
        await tx.roster.createMany({
          data: facultyOnlyIds.map((userId: string) => ({
            userId,
            courseId: course.id,
            role: 'FACULTY',
          })),
        });
      }

      // Re-read with faculty populated for response
      const withRoster = await tx.course.findUnique({
        where: { id: course.id },
        include: {
          roster: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, role: true } },
            },
          },
        },
      });

      const faculty =
        withRoster?.roster
          .filter((r: RosterItem) => r.role === 'FACULTY')
          .map((r: RosterItem) => r.user) ?? [];

      return { course, faculty, withRoster };
    });

    if (session?.user?.id) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'CREATE_COURSE',
        severity: 'INFO',
        category: 'COURSE',
        courseId: created.course.id,
        metadata: {
          courseId: created.course.id,
          courseName: created.course.name,
          courseCode: created.course.code,
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Course created successfully',
        course: {
          id: created.course.id,
          name: created.course.name,
          code: created.course.code,
          regCode: created.course.regCode,
          semester: created.course.semester,
          credits: created.course.credits,
          startDate: created.course.startDate,
          endDate: created.course.endDate,
          registrationOpenAt: created.course.registrationOpenAt,
          registrationCloseAt: created.course.registrationCloseAt,
          isPublished: created.course.isPublished,
          isArchived: created.course.isArchived,
          emptyStringNotation: created.course.emptyStringNotation,
          enrolled:
            created.withRoster?.roster.map((r: RosterItem) => ({
              ...r.user,
              courseRole: r.role,
            })) ?? [],
        },
      },
      { status: 201 },
    );
  } catch (err) {
    // If it’s a Zod error, send normalized validation issues
    const resp = validationResponse(err);
    if (resp.status === 400) return resp;

    console.error('Failed to create course:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
