import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { canArchiveCourse, canUnpublishCourse } from '@/lib/course-status-checks';
import { isAdmin, canManageCourse } from '@/lib/permissions';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { apiError } from '@/lib/api/http';
import { toDateTimeInTimezone } from '@/lib/date-utils';
import { resolveCourseTimezone } from '@/lib/course-timezone';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { sumProblemPoints, toEnrolled, toStudentSafeEnrolled } from '@/lib/course-format';
import { toEmptyStringNotation } from '@/lib/empty-string-notation';
import { CourseUpdateApiSchema } from '@/schemas/course';
import {
  countByAssignment,
  studentsWithSubmissions,
  type OptionalCountDelegate,
} from '@/lib/course/aggregates';
import { diffFacultyRoster } from '@/lib/course/faculty';

/**
 * Fetches one course with derived metadata, shaped by the `view` query param to
 * keep payloads lean (full/summary/roster/assignments/problems). Assignments come
 * back with derived point totals and submission/comment counts; problems are
 * tagged with whether an assignment uses them; the roster is flattened into a
 * single `enrolled` array, and the caller's own course role is included. Access is
 * restricted: any enrolled member of the course (any role) or a system admin.
 * @openapi
 * summary: Get a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - name: view
 *     in: query
 *     description: Controls which relations are included.
 *     schema: { type: string, enum: [full, summary, roster, assignments, problems], default: full }
 * responses:
 *   200:
 *     description: The course with metadata for the requested view.
 *   400: { description: Missing course id. }
 *   401: { description: Not signed in. }
 *   403: { description: Not enrolled in the course and not a system admin. }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, ctx, { user, courseId: id }) => {
    const view = new URL(req.url).searchParams.get('view') ?? 'full';

    try {
      const includeRoster = view === 'full' || view === 'summary' || view === 'roster';
      const includeAssignments = view === 'full' || view === 'summary' || view === 'assignments';
      const includeProblems = view === 'full' || view === 'problems';

      // Only course staff (FACULTY/TA) or a system admin may see unpublished
      // assignments and the course-wide problem bank; a student must see neither.
      // Resolve the viewer's role BEFORE the course query so it gates the query
      // itself (rather than returning the data and filtering after the fact).
      const viewerRoster = await prisma.roster.findFirst({
        where: { courseId: id, userId: user.id },
        select: { role: true },
      });
      const viewerIsAdmin = isAdmin(user);
      const isStaff =
        viewerIsAdmin || viewerRoster?.role === 'FACULTY' || viewerRoster?.role === 'TA';

      const course = await prisma.course.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              assignments: true,
              problems: true,
              roster: true,
            },
          },
          ...(includeRoster
            ? {
                roster: {
                  select: {
                    role: true,
                    user: {
                      select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        avatar: true,
                      },
                    },
                  },
                },
              }
            : {}),
          ...(includeProblems && isStaff ? { problems: true } : {}),
          ...(includeAssignments
            ? {
                assignments: {
                  // Students only ever see published assignments here.
                  where: isStaff ? {} : { isPublished: true },
                  include: {
                    problems: {
                      select: {
                        maxPoints: true,
                      },
                    },
                    _count: {
                      select: { problems: true },
                    },
                    // Per-student due-date overrides, staff-only (peers' names + dates
                    // must never reach a student). Feeds the "overrides" badge/popover.
                    ...(isStaff
                      ? {
                          overrides: {
                            select: {
                              unlockAt: true,
                              dueDate: true,
                              lateCutoff: true,
                              allowLateSubmissions: true,
                              user: {
                                select: { firstName: true, lastName: true, email: true },
                              },
                            },
                          },
                        }
                      : {}),
                  },
                },
              }
            : {}),
        },
      });

      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }

      // Course membership was enforced by the wrapper (access: 'read'); the
      // viewer's role (viewerRoster/isStaff) was resolved above the query.

      // The findUnique uses conditional includes, so widen to the relations and
      // _count that may be present for the requested view.
      type OverrideRowRaw = {
        unlockAt: Date | null;
        dueDate: Date | null;
        lateCutoff: Date | null;
        allowLateSubmissions: boolean | null;
        user: { firstName: string | null; lastName: string | null; email: string };
      };
      type AssignmentRow = Record<string, unknown> & {
        id: string;
        unlockAt?: Date | null;
        assignedToEveryone?: boolean;
        isGroup?: boolean;
        problems?: Array<{ maxPoints?: number | null }>;
        _count?: { problems?: number };
        overrides?: OverrideRowRaw[];
      };
      const courseData = course as unknown as Omit<
        typeof course,
        'roster' | 'assignments' | 'problems' | '_count'
      > & {
        roster?: Array<{ role: string; user: Record<string, unknown> }>;
        assignments?: AssignmentRow[];
        problems?: Array<Record<string, unknown>>;
        _count?: { assignments?: number; problems?: number; roster?: number };
      };
      const submissionDelegate = prisma.submission as unknown as OptionalCountDelegate;
      const commentDelegate = prisma.comment as unknown as OptionalCountDelegate;

      const rosterRows = courseData.roster ?? [];
      const assignmentRows = courseData.assignments ?? [];
      const problemRows = courseData.problems ?? [];

      const assignmentIds = includeAssignments ? assignmentRows.map((a) => String(a.id)) : [];

      let enrolled: Array<Record<string, unknown>> = [];
      if (includeRoster && isStaff) {
        const studentIds = rosterRows
          .filter((r) => r.role === 'STUDENT')
          .map((r) => String(r.user.id));

        const submittedStudentIds = await studentsWithSubmissions(
          submissionDelegate,
          studentIds,
          assignmentIds,
          (studentId) =>
            prisma.submission
              .findFirst({
                where: { studentId, assignmentId: { in: assignmentIds } },
                select: { studentId: true },
              })
              .then(Boolean),
        );

        enrolled = rosterRows.map((r) => ({
          ...r.user,
          courseRole: r.role,
          hasSubmissions:
            r.role === 'STUDENT' ? submittedStudentIds.has(String(r.user.id)) : false,
        }));
      } else if (includeRoster) {
        // Non-staff (students) get a privacy-safe roster: course staff keep their
        // names (the UI labels the course with them) but not their email, and
        // every classmate collapses to a count-only placeholder: no peer id,
        // name, or email is ever sent to a student.
        enrolled = toStudentSafeEnrolled(
          rosterRows.map((r) => ({ ...r.user, courseRole: r.role })),
        );
      }

      let assignmentsWithProblemCount: Array<Record<string, unknown>> = [];
      if (includeAssignments) {
        // Class-wide submission/comment totals are staff-only aggregates; students
        // must not learn peers' activity volume, so skip the queries entirely for
        // non-staff (the counts then default to 0 below).
        // The two aggregates are independent; run them concurrently on this hot
        // read path rather than one after the other.
        const [submissionCountMap, commentCountMap] = isStaff
          ? await Promise.all([
              countByAssignment(submissionDelegate, assignmentIds, (assignmentId) =>
                prisma.submission.count({ where: { assignmentId } }),
              ),
              countByAssignment(commentDelegate, assignmentIds, (assignmentId) =>
                prisma.comment.count({ where: { assignmentId } }),
              ),
            ])
          : [new Map<string, number>(), new Map<string, number>()];

        assignmentsWithProblemCount = assignmentRows.map((assignment) => {
          const totalProblemPoints = sumProblemPoints(assignment.problems);

          const submissionCount = submissionCountMap.get(assignment.id) ?? 0;
          const commentCount = commentCountMap.get(assignment.id) ?? 0;

          return {
            id: assignment.id,
            title: assignment.title,
            description: assignment.description,
            dueDate: assignment.dueDate,
            unlockAt: assignment.unlockAt ?? null,
            assignedToEveryone: assignment.assignedToEveryone ?? true,
            isGroup: assignment.isGroup ?? false,
            allowLateSubmissions: assignment.allowLateSubmissions,
            lateCutoff: assignment.lateCutoff,
            maxPoints: totalProblemPoints,
            isPublished: assignment.isPublished,
            createdAt: assignment.createdAt,
            updatedAt: assignment.updatedAt,
            courseId: assignment.courseId,
            problemCount: assignment._count?.problems ?? 0,
            // Staff-only; empty for students (overrides not selected for them).
            overrides: (assignment.overrides ?? []).map((o) => ({
              studentName:
                `${o.user.firstName ?? ''} ${o.user.lastName ?? ''}`.trim() || o.user.email,
              unlockAt: o.unlockAt,
              dueDate: o.dueDate,
              lateCutoff: o.lateCutoff,
              allowLateSubmissions: o.allowLateSubmissions,
            })),
            submissionCount,
            commentCount,
            hasSubmissionsOrComments: submissionCount > 0 || commentCount > 0,
          };
        });
      }

      let problemsWithLink: Array<Record<string, unknown>> = [];
      if (includeProblems) {
        const problemIds = problemRows.map((p) => String(p.id));
        const linked =
          problemIds.length > 0
            ? await prisma.assignmentProblem.findMany({
                where: { problemId: { in: problemIds } },
                select: { problemId: true },
              })
            : [];
        const linkedSet = new Set(linked.map((l: { problemId: string }) => l.problemId));

        problemsWithLink = problemRows.map((p) => ({
          ...p,
          usedByAssignment: linkedSet.has(String(p.id)),
        }));
      }

      // Viewer's role, from the roster lookup above (viewerIsAdmin/isStaff too).
      const viewerRole: string | null = viewerRoster?.role ?? null;

      const response = {
        id: course.id,
        name: course.name,
        code: course.code,
        // The registration/join code is staff-only; a student must not receive it.
        regCode: isStaff ? course.regCode : null,
        semester: course.semester,
        credits: course.credits,
        startDate: course.startDate,
        endDate: course.endDate,
        registrationOpenAt: course.registrationOpenAt,
        registrationCloseAt: course.registrationCloseAt,
        isPublished: course.isPublished,
        isArchived: course.isArchived,
        emptyStringNotation: course.emptyStringNotation,
        createdAt: course.createdAt,
        updatedAt: course.updatedAt,
        // Only include a single enrolled array (user objects with courseRole)
        enrolled: includeRoster ? enrolled : [],
        problems: includeProblems ? problemsWithLink : [],
        assignments: includeAssignments ? assignmentsWithProblemCount : [],
        // For non-staff the counts must reflect only what they can see (published
        // assignments; no problem bank), not the course-wide totals.
        assignmentTotal: isStaff
          ? (courseData._count?.assignments ?? assignmentRows.length)
          : assignmentRows.length,
        problemTotal: isStaff ? (courseData._count?.problems ?? problemRows.length) : 0,
        rosterTotal: courseData._count?.roster ?? rosterRows.length,
        viewerRole,
        viewerIsAdmin,
      };

      return NextResponse.json(response);
    } catch (error) {
      console.error('GET /api/courses/[id] error:', error);
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  },
  { access: 'read', deniedAction: 'COURSE_VIEW_DENIED' },
);

/**
 * Updates a course's details and, when `instructorIds` is supplied, reconciles its
 * faculty roster (adds, promotes, or removes to match the desired set). Runs the
 * same archive/unpublish safety checks as the dedicated toggles, requires a
 * registration window, and records a before→after diff of changed fields.
 * Course staff (faculty or TAs) or a system admin.
 * @openapi
 * summary: Update a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [name, code, semester, credits, startDate, endDate, registrationOpenAt, registrationCloseAt, isPublished, isArchived]
 *         properties:
 *           name: { type: string }
 *           code: { type: string }
 *           semester: { type: string }
 *           credits: { type: number }
 *           startDate: { type: string }
 *           endDate: { type: string }
 *           registrationOpenAt: { type: string }
 *           registrationCloseAt: { type: string }
 *           isPublished: { type: boolean }
 *           isArchived: { type: boolean }
 *           emptyStringNotation: { type: string }
 *           instructorIds: { type: array, items: { type: string }, description: "If present, becomes the exact faculty set" }
 * responses:
 *   200:
 *     description: The updated course with roster and assignments.
 *   400: { description: "Missing id, invalid isArchived, empty instructor list, or missing registration window." }
 *   403: { description: "Not course staff (faculty or TAs) or a system admin, or an archive/unpublish safety check failed." }
 *   500: { description: Server error. }
 */
export const PUT = withCourseAuth(
  async (req, ctx, { session, user, courseId: id }) => {
    // Parse + validate request
    const parsed = await readJson(req, CourseUpdateApiSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // The course's timezone anchors its dates/deadlines. Allow updating it (validated);
    // otherwise keep the course's existing zone. Dates below are interpreted in it.
    let courseTimezone: string;
    if (!body.timezone) {
      courseTimezone = await resolveCourseTimezone(id);
    } else if (
      typeof body.timezone === 'string' &&
      COMMON_TIMEZONES.includes(body.timezone as (typeof COMMON_TIMEZONES)[number])
    ) {
      courseTimezone = body.timezone;
    } else {
      return NextResponse.json({ error: 'Invalid timezone.' }, { status: 400 });
    }

    // Centralized check for archiving
    if (body.isArchived) {
      const { canArchive, reason } = await canArchiveCourse(
        prisma,
        id,
        body.startDate,
        body.endDate,
      );
      if (!canArchive) {
        await createEnhancedActivityLog(prisma, req, {
          userId: session?.user?.id ?? null,
          action: 'COURSE_ARCHIVE_REJECTED',
          category: 'COURSE',
          severity: 'WARNING',
          courseId: id,
          metadata: { reason },
        });
        return NextResponse.json({ error: reason }, { status: 403 });
      }
    }

    // Centralized check for unpublishing
    if (!body.isPublished) {
      const { canUnpublish, reason } = await canUnpublishCourse(prisma, id);
      if (!canUnpublish) {
        await createEnhancedActivityLog(prisma, req, {
          userId: session?.user?.id ?? null,
          action: 'COURSE_UNPUBLISH_REJECTED',
          category: 'COURSE',
          severity: 'WARNING',
          courseId: id,
          metadata: { reason },
        });
        return NextResponse.json({ error: reason }, { status: 403 });
      }
    }

    try {
      // Prior values are snapshotted inside the transaction (below) so the audit
      // can record what actually changed.
      let before: Record<string, unknown> | null = null;

      const instructorIds = Array.isArray(body.instructorIds) ? body.instructorIds : null;
      if (Array.isArray(instructorIds) && instructorIds.length === 0) {
        return NextResponse.json(
          { error: 'At least one faculty member is required.' },
          { status: 400 },
        );
      }

      // Editing the faculty roster is FACULTY/admin-only. The `manage` gate on this
      // route also admits TAs, so without this check a TA could send their own id as
      // `instructorIds` to promote themselves to FACULTY and remove every existing
      // instructor. Every other field above is a normal staff-editable course setting.
      if (instructorIds && !(await canManageCourse(user, id, ['FACULTY']))) {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'COURSE_FACULTY_EDIT_DENIED',
          category: 'COURSE',
          severity: 'SECURITY',
          courseId: id,
          metadata: { reason: 'changing the faculty roster is faculty/admin-only' },
        });
        return NextResponse.json(
          { error: 'Only faculty or an administrator can change the faculty roster.' },
          { status: 403 },
        );
      }

      // Update the course and optionally sync faculty (ADMIN) roster entries
      const updatedCourse = await prisma.$transaction(async (tx) => {
        before = await tx.course.findUnique({
          where: { id },
          select: {
            name: true,
            code: true,
            semester: true,
            credits: true,
            isPublished: true,
            isArchived: true,
            emptyStringNotation: true,
            startDate: true,
            endDate: true,
            registrationOpenAt: true,
            registrationCloseAt: true,
          },
        });

        await tx.course.update({
          where: { id },
          data: {
            name: body.name,
            code: body.code,
            semester: body.semester,
            credits: Number(body.credits),
            timezone: courseTimezone,
            startDate: toDateTimeInTimezone(body.startDate, courseTimezone),
            endDate: toDateTimeInTimezone(body.endDate, courseTimezone),
            registrationOpenAt: body.registrationOpenAt
              ? toDateTimeInTimezone(body.registrationOpenAt, courseTimezone)
              : null,
            registrationCloseAt: body.registrationCloseAt
              ? toDateTimeInTimezone(body.registrationCloseAt, courseTimezone)
              : null,
            isPublished: body.isPublished,
            isArchived: body.isArchived,
            emptyStringNotation: toEmptyStringNotation(body.emptyStringNotation),
          },
        });

        if (instructorIds) {
          const existingRoster = await tx.roster.findMany({
            where: { courseId: id },
            select: { userId: true, role: true },
          });
          const { toAdd, toPromote, toRemove } = diffFacultyRoster(existingRoster, instructorIds);

          if (toRemove.length > 0) {
            await tx.roster.deleteMany({
              where: { courseId: id, role: 'FACULTY', userId: { in: toRemove } },
            });
          }

          if (toPromote.length > 0) {
            await tx.roster.updateMany({
              where: { courseId: id, userId: { in: toPromote } },
              data: { role: 'FACULTY' },
            });
          }

          if (toAdd.length > 0) {
            await tx.roster.createMany({
              data: toAdd.map((userId: string) => ({
                userId,
                courseId: id,
                role: 'FACULTY',
              })),
              skipDuplicates: true,
            });
          }
        }

        const refreshed = await tx.course.findUnique({
          where: { id },
          include: {
            problems: true,
            assignments: {
              include: {
                problems: {
                  select: {
                    maxPoints: true,
                  },
                },
                _count: {
                  select: { problems: true },
                },
              },
            },
            roster: {
              select: {
                role: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        });

        if (!refreshed) {
          throw new Error('Course not found after update');
        }

        return refreshed;
      });

      // Attach problem counts to assignments. Batch the submission/comment totals
      // across all assignments (one aggregate each) rather than a per-assignment
      // count() loop, the same approach the GET view uses.
      const updatedAssignmentIds = updatedCourse.assignments.map((a) => a.id);
      const submissionCountMap = await countByAssignment(
        prisma.submission as unknown as OptionalCountDelegate,
        updatedAssignmentIds,
        (assignmentId) => prisma.submission.count({ where: { assignmentId } }),
      );
      const commentCountMap = await countByAssignment(
        prisma.comment as unknown as OptionalCountDelegate,
        updatedAssignmentIds,
        (assignmentId) => prisma.comment.count({ where: { assignmentId } }),
      );
      const assignmentsWithProblemCount = updatedCourse.assignments.map((assignment) => {
        const submissionCount = submissionCountMap.get(assignment.id) ?? 0;
        const commentCount = commentCountMap.get(assignment.id) ?? 0;
        return {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          dueDate: assignment.dueDate,
          maxPoints: sumProblemPoints(assignment.problems),
          isPublished: assignment.isPublished,
          createdAt: assignment.createdAt,
          updatedAt: assignment.updatedAt,
          courseId: assignment.courseId,
          problemCount: assignment._count.problems,
          submissionCount,
          commentCount,
          hasSubmissionsOrComments: submissionCount > 0 || commentCount > 0,
        };
      });

      // Record what actually changed (before → after). Publish/archive status
      // changes especially matter for a course's lifecycle.
      const AUDITED_COURSE_FIELDS = [
        'name',
        'code',
        'semester',
        'credits',
        'isPublished',
        'isArchived',
        'emptyStringNotation',
        'startDate',
        'endDate',
        'registrationOpenAt',
        'registrationCloseAt',
      ] as const;
      const toComparable = (v: unknown): string | number | boolean | null =>
        v instanceof Date ? v.toISOString() : ((v as string | number | boolean | null) ?? null);
      const changes: Record<
        string,
        { from: string | number | boolean | null; to: string | number | boolean | null }
      > = {};
      for (const field of AUDITED_COURSE_FIELDS) {
        const from = toComparable((before as Record<string, unknown> | null)?.[field]);
        const to = toComparable((updatedCourse as Record<string, unknown>)[field]);
        if (from !== to) changes[field] = { from, to };
      }

      // Log the update action to ActivityLog
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_COURSE',
        severity: 'INFO',
        category: 'COURSE',
        courseId: updatedCourse.id,
        metadata: {
          actorId: user.id,
          courseId: updatedCourse.id,
          changedFields: Object.keys(changes),
          changes,
        },
      });

      // Determine viewer's course role. Reuse the session/user already resolved at
      // the top of PUT instead of calling auth() again.
      let viewerRole: string | null = null;
      let viewerIsAdmin = false;
      if (session?.user) {
        const viewerRoster = await prisma.roster.findFirst({
          where: { courseId: updatedCourse.id, userId: session.user.id },
          select: { role: true },
        });
        viewerRole = viewerRoster?.role ?? null;
        viewerIsAdmin = isAdmin(session.user);
      }

      return NextResponse.json({
        id: updatedCourse.id,
        name: updatedCourse.name,
        code: updatedCourse.code,
        regCode: updatedCourse.regCode,
        semester: updatedCourse.semester,
        credits: updatedCourse.credits,
        startDate: updatedCourse.startDate,
        endDate: updatedCourse.endDate,
        registrationOpenAt: updatedCourse.registrationOpenAt,
        registrationCloseAt: updatedCourse.registrationCloseAt,
        isPublished: updatedCourse.isPublished,
        isArchived: updatedCourse.isArchived,
        emptyStringNotation: updatedCourse.emptyStringNotation,
        createdAt: updatedCourse.createdAt,
        updatedAt: updatedCourse.updatedAt,
        // Only include a single enrolled array (user objects with courseRole)
        enrolled: toEnrolled(updatedCourse.roster),
        problems: updatedCourse.problems,
        assignments: assignmentsWithProblemCount,
        viewerRole,
        viewerIsAdmin,
      });
    } catch (error) {
      console.error('PUT /api/courses/[id] error:', error);
      await logError(req, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_UPDATE_ERROR',
        category: 'COURSE',
        error,
        courseId: id,
      });
      return NextResponse.json({ error: 'Failed to update course' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'COURSE_UPDATE_DENIED', blockWhenArchived: true },
);

/**
 * Deletes a course (system admin only). An **empty** course (no assignments, no
 * problems, no student enrollments, and no submissions) is removed permanently
 * (its staff-only roster cascades away; audit logs keep a nulled course pointer).
 * Any course that holds real work or students is **soft-deleted** instead: the row
 * and all its data are retained but `deletedAt` is stamped so the access gates and
 * list queries treat it as gone (recoverable later). The response says which
 * happened via `{ deleted: 'hard' | 'soft' }`.
 * @openapi
 * summary: Delete a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: "Course deleted; body reports whether it was a hard or soft delete."
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { deleted: { type: string, enum: [hard, soft] } } }
 *   401: { description: Not signed in. }
 *   403: { description: Not a system admin (logged as a security event). }
 *   404: { description: Course not found. }
 *   500: { description: Server error. }
 */
export const DELETE = withCourseAuth(
  async (req, ctx, { session, user, courseId: id }) => {
    // Deleting a course is admin-only. The wrapper admits course staff, so reject a
    // non-admin (faculty/TA) here; staff may archive a course but never delete it.
    if (!isAdmin(user)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'COURSE_DELETE_DENIED',
        category: 'COURSE',
        severity: 'SECURITY',
        courseId: id,
        metadata: { reason: 'course deletion is admin-only' },
      });
      return NextResponse.json({ error: 'Only an admin can delete a course' }, { status: 403 });
    }

    const course = await prisma.course.findFirst({
      where: { id },
      select: { id: true, name: true, code: true, semester: true },
    });
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    try {
      // A course is "empty" only when it holds no work and no students. Such a
      // course can be dropped permanently; anything with real data is soft-deleted
      // so grades/submissions/audit survive.
      const [assignmentCount, problemCount, studentCount, submissionCount] = await Promise.all([
        prisma.assignment.count({ where: { courseId: id } }),
        prisma.problem.count({ where: { courseId: id } }),
        prisma.roster.count({ where: { courseId: id, role: 'STUDENT' } }),
        prisma.submission.count({ where: { courseId: id } }),
      ]);
      const isEmpty =
        assignmentCount === 0 &&
        problemCount === 0 &&
        studentCount === 0 &&
        submissionCount === 0;

      if (isEmpty) {
        // Hard delete: the schema cascades remove the (staff-only) roster, and the
        // audit log's courseId is SetNull, so the log survives with a null pointer.
        await prisma.course.delete({ where: { id } });
      } else {
        // Soft delete: retain the row and its data, but hide it everywhere.
        await prisma.course.update({ where: { id }, data: { deletedAt: new Date() } });
      }

      // Record which course was deleted (and how). The course row may be gone, so its
      // id goes in metadata only (not the log's courseId FK).
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'DELETE_COURSE',
        severity: 'INFO',
        category: 'COURSE',
        metadata: {
          actorId: user.id,
          courseId: id,
          courseName: course.name,
          courseCode: course.code,
          semester: course.semester,
          mode: isEmpty ? 'hard' : 'soft',
          assignmentCount,
          problemCount,
          studentCount,
          submissionCount,
        },
      });
      return NextResponse.json({ deleted: isEmpty ? 'hard' : 'soft' }, { status: 200 });
    } catch (error) {
      console.error('DELETE /api/courses/[id] error:', error);
      await logError(req, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_DELETE_ERROR',
        category: 'COURSE',
        error,
        courseId: id,
      });
      return apiError(500, 'Internal Server Error');
    }
  },
  { access: 'manage', deniedAction: 'COURSE_DELETE_DENIED' },
);
