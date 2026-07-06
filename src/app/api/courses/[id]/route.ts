// /src/api/courses/[id]/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canArchiveCourse, canUnpublishCourse } from '@/lib/course-status-checks';
import { toDateTimeInTimezone } from '@/lib/date-utils';
import { toEmptyStringNotation } from '@/lib/empty-string-notation';

// GET: Fetch a course by ID with view-based metadata
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const view = new URL(req.url).searchParams.get('view') ?? 'full';

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  try {
    const includeRoster = view === 'full' || view === 'summary' || view === 'roster';
    const includeAssignments = view === 'full' || view === 'summary' || view === 'assignments';
    const includeProblems = view === 'full' || view === 'problems';

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
                      role: true,
                      email: true,
                      avatar: true,
                    },
                  },
                },
              },
            }
          : {}),
        ...(includeProblems ? { problems: true } : {}),
        ...(includeAssignments
          ? {
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
            }
          : {}),
      },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    const rosterRows = ((course as any).roster ?? []) as Array<{
      role: string;
      user: Record<string, unknown>;
    }>;
    const assignmentRows = ((course as any).assignments ?? []) as Array<any>;
    const problemRows = ((course as any).problems ?? []) as Array<Record<string, unknown>>;

    const assignmentIds = includeAssignments ? assignmentRows.map((a) => String(a.id)) : [];

    let enrolled: Array<Record<string, unknown>> = [];
    if (includeRoster) {
      const studentIds = rosterRows
        .filter((r) => r.role === 'STUDENT')
        .map((r) => String(r.user.id));

      const studentSubmissionRows =
        assignmentIds.length > 0 && studentIds.length > 0
          ? (prisma.submission as any).groupBy
            ? await (prisma.submission as any).groupBy({
                by: ['studentId'],
                where: {
                  studentId: { in: studentIds },
                  assignmentId: { in: assignmentIds },
                },
              })
            : (prisma.submission as any).findMany
              ? await (prisma.submission as any).findMany({
                  where: {
                    studentId: { in: studentIds },
                    assignmentId: { in: assignmentIds },
                  },
                  select: { studentId: true },
                })
              : await Promise.all(
                  studentIds.map(async (studentId) => {
                    const hasSubmission = await prisma.submission.findFirst({
                      where: {
                        studentId,
                        assignmentId: { in: assignmentIds },
                      },
                      select: { studentId: true },
                    });
                    return hasSubmission ? { studentId } : null;
                  }),
                ).then((rows) => rows.filter((row): row is { studentId: string } => !!row))
          : [];
      const studentsWithSubmissions = new Set(
        studentSubmissionRows.map((row: { studentId: string }) => row.studentId),
      );

      enrolled = rosterRows.map((r) => ({
        ...r.user,
        courseRole: r.role,
        hasSubmissions:
          r.role === 'STUDENT' ? studentsWithSubmissions.has(String(r.user.id)) : false,
      }));
    }

    let assignmentsWithProblemCount: Array<Record<string, unknown>> = [];
    if (includeAssignments) {
      const submissionCounts =
        assignmentIds.length > 0
          ? (prisma.submission as any).groupBy
            ? await (prisma.submission as any).groupBy({
                by: ['assignmentId'],
                where: { assignmentId: { in: assignmentIds } },
                _count: { _all: true },
              })
            : (prisma.submission as any).findMany
              ? await (prisma.submission as any).findMany({
                  where: { assignmentId: { in: assignmentIds } },
                  select: { assignmentId: true },
                })
              : await Promise.all(
                  assignmentIds.map(async (assignmentId) => ({
                    assignmentId,
                    _count: { _all: await prisma.submission.count({ where: { assignmentId } }) },
                  })),
                )
          : [];
      const commentCounts =
        assignmentIds.length > 0
          ? (prisma.comment as any).groupBy
            ? await (prisma.comment as any).groupBy({
                by: ['assignmentId'],
                where: { assignmentId: { in: assignmentIds } },
                _count: { _all: true },
              })
            : (prisma.comment as any).findMany
              ? await (prisma.comment as any).findMany({
                  where: { assignmentId: { in: assignmentIds } },
                  select: { assignmentId: true },
                })
              : await Promise.all(
                  assignmentIds.map(async (assignmentId) => ({
                    assignmentId,
                    _count: { _all: await prisma.comment.count({ where: { assignmentId } }) },
                  })),
                )
          : [];

      const submissionCountMap = new Map<string, number>();
      submissionCounts.forEach((row: any) => {
        const key = String(row.assignmentId);
        const increment = row?._count?._all ?? 1;
        submissionCountMap.set(key, (submissionCountMap.get(key) ?? 0) + increment);
      });

      const commentCountMap = new Map<string, number>();
      commentCounts.forEach((row: any) => {
        const key = String(row.assignmentId);
        const increment = row?._count?._all ?? 1;
        commentCountMap.set(key, (commentCountMap.get(key) ?? 0) + increment);
      });

      assignmentsWithProblemCount = assignmentRows.map((assignment) => {
        const totalProblemPoints = (assignment.problems ?? []).reduce((sum: number, ap: any) => {
          const value = typeof ap.maxPoints === 'number' ? ap.maxPoints : 0;
          return sum + (Number.isFinite(value) ? value : 0);
        }, 0);

        const submissionCount = submissionCountMap.get(assignment.id) ?? 0;
        const commentCount = commentCountMap.get(assignment.id) ?? 0;

        return {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          dueDate: assignment.dueDate,
          allowLateSubmissions: assignment.allowLateSubmissions,
          lateCutoff: assignment.lateCutoff,
          maxPoints: totalProblemPoints,
          isPublished: assignment.isPublished,
          createdAt: assignment.createdAt,
          updatedAt: assignment.updatedAt,
          courseId: assignment.courseId,
          problemCount: assignment._count?.problems ?? 0,
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

    // Determine viewer's course role if authenticated
    const session = await auth();
    let viewerRole: string | null = null;
    let viewerDefaultRole: string | null = null;
    if (session?.user) {
      const viewerRoster = await prisma.roster.findFirst({
        where: { courseId: course.id, userId: session.user.id },
        select: { role: true },
      });
      viewerRole = viewerRoster?.role ?? null;
      viewerDefaultRole = session.user.role ?? null;
    }

    const response = {
      id: course.id,
      name: course.name,
      code: course.code,
      regCode: course.regCode,
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
      assignmentTotal:
        typeof (course as any)._count?.assignments === 'number'
          ? (course as any)._count.assignments
          : assignmentRows.length,
      problemTotal:
        typeof (course as any)._count?.problems === 'number'
          ? (course as any)._count.problems
          : problemRows.length,
      rosterTotal:
        typeof (course as any)._count?.roster === 'number'
          ? (course as any)._count.roster
          : rosterRows.length,
      viewerRole,
      viewerDefaultRole,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('GET /api/courses/[id] error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT: Update a course (Faculty/Admin/TA only)
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  // Get authenticated user session
  const session = await auth();
  const user = session?.user;

  // Allow only ADMIN, FACULTY, or TA to edit courses
  if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'COURSE_UPDATE_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Parse request
  const body = await req.json();

  // Get user's timezone (DB user > system settings > default)
  let userTimezone = 'America/New_York';
  if (user?.id) {
    const userRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: { timezone: true },
    });
    if (userRecord?.timezone) {
      userTimezone = userRecord.timezone;
    } else {
      const system = await prisma.systemSettings.findUnique({ where: { id: 1 } });
      userTimezone = system?.timezone || userTimezone;
    }
  }

  // Validate input
  if (typeof body.isArchived !== 'boolean') {
    return NextResponse.json({ error: 'isArchived must be a boolean' }, { status: 400 });
  }

  // Centralized check for archiving
  if (body.isArchived) {
    const { canArchive, reason } = await canArchiveCourse(prisma, id, body.startDate, body.endDate);
    if (!canArchive) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_ARCHIVE_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
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
        action: 'COURSE_PUBLISH_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: reason }, { status: 403 });
    }
  }

  if (!body.registrationOpenAt || !body.registrationCloseAt) {
    return NextResponse.json({ error: 'Registration window is required.' }, { status: 400 });
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
          startDate: toDateTimeInTimezone(body.startDate, userTimezone),
          endDate: toDateTimeInTimezone(body.endDate, userTimezone),
          registrationOpenAt: body.registrationOpenAt
            ? toDateTimeInTimezone(body.registrationOpenAt, userTimezone)
            : null,
          registrationCloseAt: body.registrationCloseAt
            ? toDateTimeInTimezone(body.registrationCloseAt, userTimezone)
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
        const existingFacultyIds = new Set(
          existingRoster.filter((r) => r.role === 'FACULTY').map((r) => r.userId),
        );
        const desiredFacultyIds = new Set(instructorIds);

        const toAdd: string[] = [];
        const toPromote: string[] = [];
        instructorIds.forEach((userId: string) => {
          const existing = existingRoster.find((r) => r.userId === userId);
          if (!existing) {
            toAdd.push(userId);
            return;
          }
          if (existing.role !== 'FACULTY') {
            toPromote.push(userId);
          }
        });
        const toRemove = Array.from(existingFacultyIds).filter(
          (userId) => !desiredFacultyIds.has(userId),
        );

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
                  role: true,
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

    // Attach problem counts to assignments
    const assignmentsWithProblemCount = await Promise.all(
      updatedCourse.assignments.map(
        async (assignment: (typeof updatedCourse.assignments)[number]) => {
          const totalProblemPoints = (assignment.problems ?? []).reduce((sum, ap) => {
            const value = typeof ap.maxPoints === 'number' ? ap.maxPoints : 0;
            return sum + (Number.isFinite(value) ? value : 0);
          }, 0);

          const submissionCount = await prisma.submission.count({
            where: { assignmentId: assignment.id },
          });
          const commentCount = await prisma.comment.count({
            where: { assignmentId: assignment.id },
          });
          const hasSubmissionsOrComments = submissionCount > 0 || commentCount > 0;

          return {
            id: assignment.id,
            title: assignment.title,
            description: assignment.description,
            dueDate: assignment.dueDate,
            maxPoints: totalProblemPoints,
            isPublished: assignment.isPublished,
            createdAt: assignment.createdAt,
            updatedAt: assignment.updatedAt,
            courseId: assignment.courseId,
            problemCount: assignment._count.problems,
            submissionCount,
            commentCount,
            hasSubmissionsOrComments,
          };
        },
      ),
    );

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

    // Determine viewer's course role if authenticated
    const session = await auth();
    let viewerRole: string | null = null;
    let viewerDefaultRole: string | null = null;
    if (session?.user) {
      const viewerRoster = await prisma.roster.findFirst({
        where: { courseId: updatedCourse.id, userId: session.user.id },
        select: { role: true },
      });
      viewerRole = viewerRoster?.role ?? null;
      viewerDefaultRole = session.user.role ?? null;
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
      enrolled: updatedCourse.roster.map((r: (typeof updatedCourse.roster)[number]) => ({
        ...r.user,
        courseRole: r.role,
      })),
      problems: updatedCourse.problems,
      assignments: assignmentsWithProblemCount,
      viewerRole,
      viewerDefaultRole,
    });
  } catch (error) {
    console.error('PUT /api/courses/[id] error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'COURSE_UPDATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to update course' }, { status: 500 });
  }
}

// DELETE: Delete a course (Faculty/Admin/TA only, course must be archived)
export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ error: 'Missing course ID' }, { status: 400 });
  }

  // Get authenticated user session
  const session = await auth();
  const user = session?.user;

  if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'COURSE_DELETE_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Make sure the course isArchived
  const courseIsArchived = await prisma.course.findFirst({
    where: { id },
    select: { isArchived: true },
  });

  if (courseIsArchived === null || courseIsArchived.isArchived === false) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'COURSE_DELETE_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
    return NextResponse.json({ error: 'Course must be archived' }, { status: 403 });
  }

  await req.json();

  try {
    // Deleting course code
    const deletedCourse = await prisma.course.delete({
      where: {
        id,
        isArchived: true,
      },
    });

    // Record which course was deleted. The course row is gone, so its id goes in
    // metadata only (not the log's courseId FK, which would be nulled/rejected).
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'DELETE_COURSE',
      severity: 'INFO',
      category: 'COURSE',
      metadata: {
        actorId: user.id,
        courseId: id,
        courseName: deletedCourse.name,
        courseCode: deletedCourse.code,
        semester: deletedCourse.semester,
      },
    });
    return NextResponse.json({ status: 204 });
  } catch (error) {
    console.error('DELETE /api/courses/[id] error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'COURSE_DELETE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: error }, { status: 500 });
  }
}
