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
import { isAdmin } from '@/lib/permissions';
import { toDateTimeInTimezone } from '@/lib/date-utils';
import { resolveUserTimezone } from '@/lib/user-timezone';
import { generateUniqueCourseCode } from '@/lib/course-code';
import { sumProblemPoints, toEnrolled } from '@/lib/course-format';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
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
 *   administrators only — the payload spans all courses and includes every
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
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const courses = await prisma.course.findMany({
      // Soft-deleted courses are retained only for out-of-band recovery — exclude them.
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
 * roster, all in one transaction. System administrators only. Datetime-local
 * strings are interpreted in the actor's effective timezone before being stored
 * as UTC.
 * @openapi
 * summary: Create a course
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [name, code, semester, credits, startDate, endDate, registrationOpenAt, registrationCloseAt]
 *         properties:
 *           name: { type: string }
 *           code: { type: string }
 *           semester: { type: string }
 *           credits: { type: number }
 *           startDate: { type: string, description: datetime-local string }
 *           endDate: { type: string, description: datetime-local string }
 *           registrationOpenAt: { type: string, description: datetime-local string }
 *           registrationCloseAt: { type: string, description: datetime-local string }
 *           isPublished: { type: boolean }
 *           instructorIds: { type: array, items: { type: string } }
 *           facultyIds: { type: array, items: { type: string } }
 *           emptyStringNotation: { type: string }
 * responses:
 *   201:
 *     description: Course created; returns the course with its `enrolled` roster.
 *   400: { description: "Missing registration window, or Zod validation failed." }
 *   403: { description: System administrators only (logged as a security event). }
 *   409: { description: A course with that code and semester already exists. }
 *   500: { description: Server error. }
 */
export async function POST(req: Request) {
  let actorId: string | null = null;
  try {
    // 1) Parse payload of information
    const json = await req.json();

    // 2) Ensure user is authorized to create courses
    const session = await auth();
    actorId = session?.user?.id ?? null;
    // Reject a missing session or a disabled/deleted account (inactive) before the
    // admin check — a stale JWT that still says admin must not create courses.
    if (!session?.user || session.user.inactive) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isAdmin(session.user)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'COURSE_CREATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3) Get user's timezone (DB user > system settings > default)
    const userTimezone = await resolveUserTimezone(session?.user?.id);

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
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'COURSE_CREATE_ERROR',
      severity: 'ERROR',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
