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
import { readJson } from '@/lib/api/request';
import { CourseCreateApiSchema } from '@/schemas/course';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/permissions';
import { toDateTimeInTimezone } from '@/lib/date-utils';
import { resolveSystemTimezone } from '@/lib/course-timezone';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { createWithUniqueCourseCode } from '@/lib/course-code';
import { sumProblemPoints, toEnrolled } from '@/lib/course-format';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { toEmptyStringNotation } from '@/lib/empty-string-notation';
import type { Prisma } from '@prisma/client';

/**
 * Roster item shape used by this route (kept in sync with `include` below).
 * Prefer a Prisma payload type so it scales with schema changes.
 */
type RosterItem = Prisma.RosterGetPayload<{
  include: {
    user: { select: { id: true; firstName: true; lastName: true } };
  };
}>;

// ----------------------------------------
// GET /api/courses
// ----------------------------------------
/**
 * Returns every course, newest first, each with its `enrolled` roster (user +
 * courseRole) and per-assignment derived `maxPoints`/`problemCount`.
 * @openapi
 * summary: List all courses
 * description: >-
 *   Returns every course with its roster and assignment metadata. System
 *   administrators only; the payload spans all courses and includes every
 *   member's identity and each course's registration code.
 * responses:
 *   200:
 *     description: Array of courses, each with an `enrolled` roster and assignments.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   403: { description: System administrators only. }
 *   500: { description: Server error. }
 */
export async function GET(req: Request) {
  try {
    // Admin-only: this returns every course's roster identities and registration
    // codes, so it must not be reachable by non-admins (or anonymously).
    const session = await auth();
    if (!session?.user || session.user.inactive) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdmin(session.user)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'COURSES_LIST_DENIED',
        category: 'COURSE',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const courses = await prisma.course.findMany({
      // Soft-deleted courses are retained only for out-of-band recovery; exclude them.
      where: { deletedAt: null },
      include: {
        roster: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
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
      const enrolled = toEnrolled(c.roster);

      const assignmentsWithDerivedPoints = c.assignments.map((assignment) => {
        const { problems, ...restAssignment } = assignment;
        return {
          ...restAssignment,
          maxPoints: sumProblemPoints(problems),
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
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

// ----------------------------------------
// POST /api/courses
// ----------------------------------------
/**
 * Creates a course (with a generated registration code) and seeds its faculty
 * roster, all in one transaction. System administrators only. A new course is
 * always created unpublished (publishing is a separate action) and requires at
 * least one faculty member. Datetime-local strings are interpreted in the course's
 * timezone before being stored as UTC.
 * @openapi
 * summary: Create a course
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [name, code, semester, credits, startDate, endDate, registrationOpenAt, registrationCloseAt, instructorIds]
 *         properties:
 *           name: { type: string }
 *           code: { type: string }
 *           semester: { type: string }
 *           credits: { type: number }
 *           startDate: { type: string, description: datetime-local string }
 *           endDate: { type: string, description: datetime-local string }
 *           registrationOpenAt: { type: string, description: datetime-local string }
 *           registrationCloseAt: { type: string, description: datetime-local string }
 *           instructorIds: { type: array, items: { type: string }, description: "Faculty to seed the roster; at least one is required." }
 *           emptyStringNotation: { type: string }
 * responses:
 *   201:
 *     description: "Course created (always unpublished); returns the course with its `enrolled` roster."
 *   400: { description: "Missing registration window, no faculty, or Zod validation failed." }
 *   403: { description: System administrators only (logged as a security event). }
 *   409: { description: A course with that code and semester already exists. }
 *   500: { description: Server error. }
 */
export async function POST(req: Request) {
  let actorId: string | null = null;
  try {
    // 1) Authorize first: reject a missing session or a disabled/deleted account
    // (inactive) before reading/validating the body. A stale JWT that still says
    // admin must not create courses.
    const session = await auth();
    actorId = session?.user?.id ?? null;
    if (!session?.user || session.user.inactive) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdmin(session.user)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'COURSE_CREATE_DENIED',
        category: 'COURSE',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 2) Validate the payload (dates kept as strings; see CourseCreateApiSchema).
    const parsed = await readJson(req, CourseCreateApiSchema);
    if (!parsed.ok) return parsed.response;
    const json = parsed.data;

    // 3) The course's canonical timezone anchors its deadlines. Use the provided zone
    // (validated) or fall back to the system default; all the course's dates below are
    // interpreted in it, not the actor's zone.
    let courseTimezone: string;
    if (!json.timezone) {
      courseTimezone = await resolveSystemTimezone();
    } else if (
      typeof json.timezone === 'string' &&
      COMMON_TIMEZONES.includes(json.timezone as (typeof COMMON_TIMEZONES)[number])
    ) {
      courseTimezone = json.timezone;
    } else {
      return NextResponse.json({ error: 'Invalid timezone.' }, { status: 400 });
    }

    if (!json.registrationOpenAt || !json.registrationCloseAt) {
      return NextResponse.json({ error: 'Registration window is required.' }, { status: 400 });
    }

    // 4) Optional uniqueness check (code + semester)
    const exists = await prisma.course.findFirst({
      where: { code: json.code, semester: json.semester },
      select: { id: true },
    });
    if (exists) {
      return NextResponse.json(
        { error: 'A course with that code and semester already exists.' },
        { status: 409 },
      );
    }

    // 5+6) Create the course (and faculty/TA roster) in a transaction, minting a
    // unique registration code. The code is chosen before the insert, so retry with a
    // fresh one on the rare P2002 where a concurrent create claimed it first.
    const created = await createWithUniqueCourseCode((regCode) =>
      prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const course = await tx.course.create({
          data: {
            name: json.name,
            code: json.code,
            regCode,
            semester: json.semester,
            credits: json.credits,
            timezone: courseTimezone,
            startDate: toDateTimeInTimezone(json.startDate, courseTimezone),
            endDate: toDateTimeInTimezone(json.endDate, courseTimezone),
            registrationOpenAt: json.registrationOpenAt
              ? toDateTimeInTimezone(json.registrationOpenAt, courseTimezone)
              : null,
            registrationCloseAt: json.registrationCloseAt
              ? toDateTimeInTimezone(json.registrationCloseAt, courseTimezone)
              : null,
            // A course is never born published; releasing it to students is a
            // separate, deliberate action after it's staffed and populated.
            isPublished: false,
            isArchived: false,
            emptyStringNotation: toEmptyStringNotation(json.emptyStringNotation),
          },
        });

        // Seed the faculty roster (the schema guarantees at least one). TAs and
        // students are added later through the roster.
        await tx.roster.createMany({
          data: json.instructorIds.map((userId: string) => ({
            userId,
            courseId: course.id,
            role: 'FACULTY',
          })),
        });

        const taIds = Array.isArray(json.taIds)
          ? Array.from(new Set(json.taIds.filter((id) => !json.instructorIds.includes(id))))
          : [];
        if (taIds.length) {
          await tx.roster.createMany({
            data: taIds.map((userId: string) => ({
              userId,
              courseId: course.id,
              role: 'TA' as const,
            })),
          });
        }

        // Re-read with faculty populated for response
        const withRoster = await tx.course.findUnique({
          where: { id: course.id },
          include: {
            roster: {
              include: {
                user: { select: { id: true, firstName: true, lastName: true } },
              },
            },
          },
        });

        const faculty =
          withRoster?.roster
            .filter((r: RosterItem) => r.role === 'FACULTY')
            .map((r: RosterItem) => r.user) ?? [];

        return { course, faculty, withRoster };
      }),
    );

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
    await logError(req, {
      userId: actorId,
      action: 'COURSE_CREATE_ERROR',
      category: 'COURSE',
      error: err,
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
