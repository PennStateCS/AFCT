import { NextResponse } from 'next/server';
import type { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { descriptionWriteData } from '@/lib/description-write';
import type { ProblemTypeEnum } from '@/schemas/problem';
import type { RoleEnum } from '@/schemas/user';
import { AssignmentUpdateApiSchema } from '@/schemas/assignment';
import { withCourseAuth } from '@/lib/api/with-auth';
import { canManageCourse } from '@/lib/permissions';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { readJson } from '@/lib/api/request';
import { sumProblemPoints } from '@/lib/course-format';
import { resolveCourseTimezone } from '@/lib/course-timezone';
import { toEndOfDayInTimezone } from '@/lib/date-convert';
import { computeLateSubmissionState, resolveUnlockAt } from '@/lib/assignment-late-window';
import { effectiveDeadline } from '@/lib/effective-deadline';
import { overridesForStudentWhere } from '@/lib/assignment-visibility';
import { diffFields } from '@/lib/api/activity';
import { lockAssignmentWork, unpublishBlockedBy } from '@/lib/course-status-checks';

// Types
interface AssignmentWithProblemsAndCourse {
  problems: {
    problem: {
      id: string;
      title: string;
      description: string | null;
      descriptionJson: unknown;
      type: z.infer<typeof ProblemTypeEnum> | null;
      maxStates: number | null;
      isDeterministic: boolean | null;
      fileName: string | null;
      originalFileName: string | null;
    };
    maxPoints: number;
    maxSubmissions: number;
    autograderEnabled: boolean;
    showFeedback: boolean;
  }[];

  course: {
    name: string;
    code: string;
    isArchived: boolean;
    roster?: {
      role: z.infer<typeof RoleEnum> | null;
      user: {
        id: string;
        firstName: string;
        lastName: string;
      };
    }[];
  };
}

/**
 * The unpublish guard refused the change, from inside the transaction that would have made it.
 *
 * Carries which kind of work stopped it so the handler can say the same thing it always has,
 * and thrown rather than returned because the answer is only trustworthy while the rows are
 * held. The log and the response are written after the rollback, on the outer client, so a
 * refusal is still recorded.
 */
class UnpublishBlockedError extends Error {
  constructor(readonly kind: 'submissions' | 'grades') {
    super(`Assignment must not have any ${kind}`);
  }
}

/**
 * The unpublish guard, run where it counts.
 *
 * `data.isPublished` is the requested NEXT state, so `=== false` means "unpublish". Anything
 * else is an ordinary edit and takes no locks: an assignment full of work can still have its
 * title or its deadline changed, and always could.
 *
 * It used to read the counts through `prisma` before the update, which is a check-then-act
 * across three separate statements with nothing held between them. A submission arriving in
 * that gap was refused by a decision taken before it existed: the submission's own transaction
 * locked the problem link, re-read the assignment, found it published and committed, and the
 * update then unpublished an assignment that by then had work. `lockAssignmentWork` is the
 * same row `createSubmission` takes, so one of the two waits and both orders are consistent.
 */
async function assertUnpublishAllowed(
  tx: Prisma.TransactionClient,
  params: { assignmentId: string; data: { isPublished?: boolean } },
): Promise<void> {
  if (params.data.isPublished !== false) return;

  await lockAssignmentWork(tx, params.assignmentId);
  const blockedBy = await unpublishBlockedBy(tx, params.assignmentId);
  if (blockedBy) throw new UnpublishBlockedError(blockedBy);
}

/**
 * Record the refusal and answer with it, in the shape this route has always used.
 *
 * Written outside the transaction, on `prisma`, because the transaction that decided it has
 * rolled back by the time this runs and a log written inside would have gone with it.
 */
async function refuseUnpublish(
  req: Request,
  error: UnpublishBlockedError,
  params: { userId: string; courseId: string; assignmentId: string },
): Promise<NextResponse> {
  await createEnhancedActivityLog(prisma, req, {
    userId: params.userId,
    action: 'ASSIGNMENT_UNPUBLISH_REJECTED',
    category: 'ASSIGNMENT',
    severity: 'WARNING',
    courseId: params.courseId,
    assignmentId: params.assignmentId,
    metadata: { reason: `has ${error.kind}` },
  });
  return NextResponse.json({ error: error.message }, { status: 403 });
}

/**
 * Fetches one assignment (scoped to the course) with its problems and a derived
 * `maxPoints`. This is the single canonical assignment read (it absorbed the former
 * global `GET /api/assignments/[id]`). Access: the caller must be an enrolled member
 * of the course or a system admin. Course staff (faculty/TA) and admins see any
 * assignment and (in the `full` view) the course roster; non-staff members see only
 * published assignments (unpublished are 404-masked) and never receive the roster.
 * @openapi
 * summary: Get a course assignment
 * description: >-
 *   Returns the assignment with its problems. Staff/admins also get the course roster
 *   in the full view; non-staff members see published assignments only (unpublished
 *   are masked as 404) and no roster.
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - name: view
 *     in: query
 *     description: '"full" (default) includes the roster for staff; any other value omits it.'
 *     schema: { type: string, default: full }
 * responses:
 *   200: { description: "The assignment with problems (and, for staff in full view, the roster)." }
 *   401: { description: Not signed in. }
 *   403: { description: Not an enrolled member of the course and not a system admin. }
 *   404: { description: "Assignment not found in this course, or not visible to the caller." }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { aid: assignmentId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view') ?? 'full';
    // Course staff (faculty/TA) or admins see everything; the roster is staff-only
    // and unpublished assignments are hidden from non-staff members (404-masked),
    // matching the access rules of the retired global GET /api/assignments/[id].
    const isStaff = await canManageCourse(user, courseId);
    const includeRoster = view === 'full' && isStaff;

    try {
      const assignment = (await prisma.assignment.findFirst({
        where: {
          id: assignmentId,
          courseId,
        },
        include: {
          // The assignee rows that name this caller: their own individual row, or a GROUP
          // row for a group they belong to. Filtering by both means any row returned
          // proves membership (a group-assigned student was previously missed here,
          // because only individual rows were selected).
          assignees: {
            where: {
              OR: [
                { userId: user.id },
                { studentGroup: { memberships: { some: { userId: user.id } } } },
              ],
            },
            select: { userId: true, groupId: true },
          },
          // This caller's date overrides (their own and their group's), used to resolve
          // their effective unlock date for the content lock.
          overrides: {
            where: overridesForStudentWhere(user.id),
            select: {
              targetType: true,
              userId: true,
              groupId: true,
              unlockAt: true,
              dueDate: true,
              lateCutoff: true,
              allowLateSubmissions: true,
            },
          },
          problems: {
            select: {
              maxPoints: true,
              maxSubmissions: true,
              autograderEnabled: true,
              showFeedback: true,
              problem: {
                select: {
                  id: true,
                  title: true,
                  description: true,
                  descriptionJson: true,
                  type: true,
                  maxStates: true,
                  isDeterministic: true,
                  fileName: true,
                  originalFileName: true,
                },
              },
            },
          },
          course: {
            select: {
              name: true,
              code: true,
              isArchived: true,
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
                          },
                        },
                      },
                    },
                  }
                : {}),
            },
          },
        },
      })) as AssignmentWithProblemsAndCourse | null;

      // Return 404 if no matching assignment was found
      if (!assignment) {
        return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
      }

      // Non-staff members may only see published assignments; hide the rest as 404.
      if (!isStaff && !(assignment as { isPublished?: boolean }).isPublished) {
        return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
      }

      // "Assign to specific students/groups": a non-staff member not assigned this work
      // can't see it either. Same 404 mask. The assignee rows were already filtered to
      // ones naming this caller (individually or via one of their groups), so any row
      // present proves membership.
      const gate = assignment as unknown as {
        assignedToEveryone?: boolean;
        assignees?: Array<{ userId: string | null; groupId?: string | null }>;
      };
      const isAssigned =
        (gate.assignedToEveryone ?? true) !== false || (gate.assignees ?? []).length > 0;
      if (!isStaff && !isAssigned) {
        return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
      }

      // Before an assignment unlocks, a non-staff member sees that it exists and when it
      // opens, but not its description or problems (Canvas-style content lock).
      const av = assignment as unknown as {
        description: string | null;
        descriptionJson: unknown;
        unlockAt: Date | null;
        dueDate: Date;
        allowLateSubmissions: boolean;
        lateCutoff: Date | null;
        overrides: Parameters<typeof effectiveDeadline>[1];
      };
      // The overrides were filtered to this caller's own plus their groups', so any group
      // id present is one of theirs and can be passed straight through.
      const callerOverrides = av.overrides ?? [];
      const eff = effectiveDeadline(
        {
          unlockAt: av.unlockAt,
          dueDate: av.dueDate,
          allowLateSubmissions: av.allowLateSubmissions,
          lateCutoff: av.lateCutoff,
        },
        callerOverrides,
        user.id,
        callerOverrides.map((o) => o.groupId).filter((gid): gid is string => gid != null),
      );
      const locked = !isStaff && !!eff.unlockAt && eff.unlockAt.getTime() > Date.now();

      // Keep problems in the structure that the frontend expects
      const problemsWithRelation = assignment.problems.map(
        (ap: (typeof assignment.problems)[number]) => ({
          problem: {
            id: ap.problem.id,
            title: ap.problem.title,
            description: ap.problem.description,
            // The rich form of the same text. Whole problems are withheld while locked (see
            // below), so this needs no separate mask, but it must travel with `description` or
            // the read surfaces silently drop back to plain text.
            descriptionJson: ap.problem.descriptionJson,
            type: ap.problem.type,
            maxStates: ap.problem.maxStates,
            isDeterministic: ap.problem.isDeterministic,
            // The problem file is the autograder's answer key. Its stored and
            // original names are withheld from non-staff members (students never
            // receive them, matching the upload/download restriction).
            fileName: isStaff ? ap.problem.fileName : null,
            originalFileName: isStaff ? ap.problem.originalFileName : null,
          },
          maxPoints: ap.maxPoints,
          maxSubmissions: ap.maxSubmissions,
          autograderEnabled: ap.autograderEnabled,
          showFeedback: ap.showFeedback,
        }),
      );

      const totalProblemPoints = sumProblemPoints(assignment.problems);

      // Extract the course roster and keep in the structure that the frontend expects
      const roster = assignment.course.roster || [];

      // Remove joined fields to avoid duplication in the response
      const { problems: _problems, course, ...assignmentData } = assignment;

      // Return structured assignment matching the frontend's expected format
      return NextResponse.json({
        ...assignmentData,
        // The dates this caller is actually held to. Spreading the row alone gave a student the
        // assignment's own dates, so an extension granted to them or to their group showed here
        // as the original deadline: every other student surface resolved it and this one, the
        // page they open to do the work, did not. Staff keep the base dates; they set those, and
        // the exceptions are listed to them separately.
        ...(isStaff
          ? {}
          : {
              unlockAt: eff.unlockAt,
              dueDate: eff.dueDate,
              lateCutoff: eff.lateCutoff,
              allowLateSubmissions: eff.allowLateSubmissions,
            }),
        description: locked ? null : av.description,
        // The rich document carries the same content as the plain text, so it has to be
        // withheld under the same lock. Spreading the row would otherwise hand a student the
        // description of an assignment that has not opened yet.
        descriptionJson: locked ? null : av.descriptionJson,
        locked,
        maxPoints: totalProblemPoints,
        problems: locked ? [] : problemsWithRelation,
        course: {
          id: courseId,
          name: course.name,
          code: course.code,
          isArchived: course.isArchived,
          ...(includeRoster
            ? {
                roster: roster.map((r: (typeof roster)[number]) => ({
                  user: r.user,
                  role: r.role,
                })),
              }
            : {}),
        },
      });
    } catch (error) {
      // Handle unexpected errors
      console.error('Failed to fetch assignment:', error);
      return NextResponse.json({ error: 'Failed to fetch assignment.' }, { status: 500 });
    }
  },
  { access: 'read', deniedAction: 'ASSIGNMENT_VIEW_DENIED' },
);

/**
 * Full update of an assignment. Course staff (faculty or TAs) or a system admin.
 * Guards protect data integrity: an assignment can't be unpublished once it has
 * submissions or grades, and its group mode can't change after any submission exists.
 * Late-submission rules are validated the same way as on create.
 * @openapi
 * summary: Update a course assignment (full)
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           title: { type: string }
 *           description: { type: string }
 *           dueDate: { type: string }
 *           unlockAt: { type: string, nullable: true, description: Available-from date; null clears it }
 *           allowLateSubmissions: { type: boolean }
 *           missingWorkIsZero: { type: boolean, description: "Whether unsubmitted work scores zero after the due date. Left alone when omitted." }
 *           lateCutoff: { type: string, nullable: true }
 *           isPublished: { type: boolean }
 * responses:
 *   200: { description: The updated assignment. }
 *   400: { description: Inconsistent late-submission window. }
 *   401: { description: Not signed in. }
 *   403: { description: "Not course staff or a system admin, or a state guard blocked the change." }
 *   404: { description: Assignment not found in this course. }
 *   500: { description: Server error. }
 */
export const PUT = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { aid: id } = await ctx.params;

    // The wrapper only confirmed the caller can manage `courseId`; verify the
    // assignment actually lives in that course before mutating it.
    const existing = await prisma.assignment.findFirst({ where: { id, courseId } });
    if (!existing) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const parsed = await readJson(req, AssignmentUpdateApiSchema);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;
    // Deadlines are anchored to the course's timezone, not the actor's.
    const courseTimezone = await resolveCourseTimezone(courseId);

    try {
      const dueDate = data.dueDate
        ? toEndOfDayInTimezone(data.dueDate, courseTimezone)
        : existing.dueDate;

      const lateState = computeLateSubmissionState({
        incomingAllowLate: data.allowLateSubmissions,
        incomingLateCutoff: data.lateCutoff,
        existingAllowLate: existing.allowLateSubmissions,
        existingLateCutoff: existing.lateCutoff,
        dueDate,
        timezone: courseTimezone,
      });

      if (!lateState.ok) {
        return NextResponse.json({ error: lateState.message }, { status: 400 });
      }

      const unlockState = resolveUnlockAt({
        incoming: data.unlockAt,
        existing: existing.unlockAt,
        dueDate,
        timezone: courseTimezone,
      });
      if (!unlockState.ok) {
        return NextResponse.json({ error: unlockState.message }, { status: 400 });
      }

      const { allowLateSubmissions, lateCutoff } = lateState;

      const updated = await prisma.$transaction(async (tx) => {
        await assertUnpublishAllowed(tx, { assignmentId: existing.id, data });
        return tx.assignment.update({
          where: { id },
          data: {
            title: data.title,
            ...descriptionWriteData(data),
            // Use the computed value (keeps the existing due date when none was sent)
            // rather than re-deriving from a possibly-undefined data.dueDate.
            dueDate,
            unlockAt: unlockState.unlockAt,
            allowLateSubmissions,
            lateCutoff,
            // Only when the caller actually sent it: an older client that knows nothing about this
            // setting must not switch it off by omission.
            ...(typeof data.missingWorkIsZero === 'boolean'
              ? { missingWorkIsZero: data.missingWorkIsZero }
              : {}),
            isPublished: data.isPublished,
          },
        });
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_ASSIGNMENT',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: id,
        metadata: {
          userId: user.id,
          courseId,
          assignmentId: id,
          title: updated.title,
          isPublished: updated.isPublished,
          dueDate: updated.dueDate ? updated.dueDate.toISOString() : null,
          unlockAt: updated.unlockAt ? updated.unlockAt.toISOString() : null,
          allowLateSubmissions: updated.allowLateSubmissions,
          lateCutoff: updated.lateCutoff ? updated.lateCutoff.toISOString() : null,
        },
      });

      return NextResponse.json(updated);
    } catch (error) {
      // A refused unpublish is a business-rule answer, not a failure: it is logged and
      // reported the way it always was, and never as a 500.
      if (error instanceof UnpublishBlockedError) {
        return refuseUnpublish(req, error, {
          userId: user.id,
          courseId,
          assignmentId: existing.id,
        });
      }
      console.error('Assignment update failed:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_UPDATE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: id,
        error,
      });
      return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_UPDATE_DENIED', blockWhenArchived: true },
);

/**
 * Partial update of an assignment: only the fields present in the body are changed.
 * Course staff (faculty or TAs) or a system admin, with the same unpublish guard and
 * late-window validation as the full update.
 * @openapi
 * summary: Update a course assignment (partial)
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           title: { type: string }
 *           description: { type: string }
 *           dueDate: { type: string }
 *           unlockAt: { type: string, nullable: true, description: Available-from date; null clears it }
 *           allowLateSubmissions: { type: boolean }
 *           missingWorkIsZero: { type: boolean, description: "Whether unsubmitted work scores zero after the due date. Left alone when omitted." }
 *           lateCutoff: { type: string, nullable: true }
 *           isPublished: { type: boolean }
 * responses:
 *   200: { description: The updated assignment. }
 *   400: { description: Inconsistent late-submission window. }
 *   401: { description: Not signed in. }
 *   403: { description: "Not course staff or a system admin, or a state guard blocked the change." }
 *   404: { description: Assignment not found in this course. }
 *   500: { description: Server error. }
 */
export const PATCH = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { aid: id } = await ctx.params;

    const existing = await prisma.assignment.findFirst({ where: { id, courseId } });
    if (!existing) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const parsed = await readJson(req, AssignmentUpdateApiSchema);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;
    // Deadlines are anchored to the course's timezone, not the actor's.
    const courseTimezone = await resolveCourseTimezone(courseId);

    try {
      const effectiveDueDate =
        data.dueDate !== undefined
          ? toEndOfDayInTimezone(data.dueDate, courseTimezone)
          : existing.dueDate;

      const lateState = computeLateSubmissionState({
        incomingAllowLate: data.allowLateSubmissions,
        incomingLateCutoff: data.lateCutoff,
        existingAllowLate: existing.allowLateSubmissions,
        existingLateCutoff: existing.lateCutoff,
        dueDate: effectiveDueDate,
        timezone: courseTimezone,
      });

      if (!lateState.ok) {
        return NextResponse.json({ error: lateState.message }, { status: 400 });
      }

      const unlockState = resolveUnlockAt({
        incoming: data.unlockAt,
        existing: existing.unlockAt,
        dueDate: effectiveDueDate,
        timezone: courseTimezone,
      });
      if (!unlockState.ok) {
        return NextResponse.json({ error: unlockState.message }, { status: 400 });
      }

      const { allowLateSubmissions, lateCutoff } = lateState;

      // Build update data object with only provided fields
      const updateData: {
        title?: string;
        description?: string | null;
        descriptionFormat?: 'PLAIN_TEXT' | 'TIPTAP_JSON';
        descriptionJson?: Prisma.InputJsonValue | typeof Prisma.DbNull;
        dueDate?: Date;
        unlockAt?: Date | null;
        allowLateSubmissions?: boolean;
        lateCutoff?: Date | null;
        isPublished?: boolean;
      } = {};

      if (data.title !== undefined) updateData.title = data.title;
      // A description write means all three columns move together, so the rich JSON and the
      // derived plain text can never drift. Either field arriving counts as a write.
      if (data.description !== undefined || data.descriptionJson !== undefined) {
        Object.assign(updateData, descriptionWriteData(data));
      }
      if (data.dueDate !== undefined) updateData.dueDate = effectiveDueDate;
      if (unlockState.changed) updateData.unlockAt = unlockState.unlockAt;
      if (data.allowLateSubmissions !== undefined) {
        updateData.allowLateSubmissions = allowLateSubmissions;
      }
      if (data.lateCutoff !== undefined) updateData.lateCutoff = lateCutoff;
      if (data.isPublished !== undefined) updateData.isPublished = data.isPublished;

      const updated = await prisma.$transaction(async (tx) => {
        await assertUnpublishAllowed(tx, { assignmentId: existing.id, data });
        return tx.assignment.update({ where: { id }, data: updateData });
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_ASSIGNMENT',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: id,
        metadata: {
          userId: user.id,
          courseId,
          assignmentId: id,
          // Old and new side by side. The names alone answered "what moved" but never "from
          // what", which is the half a complaint about a deadline turns on.
          changes: diffFields(
            existing as unknown as Record<string, unknown>,
            updateData as Record<string, unknown>,
          ),
          changedFields: Object.keys(updateData),
          title: updated.title,
        },
      });

      return NextResponse.json(updated);
    } catch (error) {
      // A refused unpublish is a business-rule answer, not a failure: it is logged and
      // reported the way it always was, and never as a 500.
      if (error instanceof UnpublishBlockedError) {
        return refuseUnpublish(req, error, {
          userId: user.id,
          courseId,
          assignmentId: existing.id,
        });
      }
      console.error('Assignment partial update failed:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_UPDATE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: id,
        error,
      });
      return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_UPDATE_DENIED', blockWhenArchived: true },
);

/**
 * Thrown inside the deletion transaction so the whole thing rolls back, rather than a guard
 * returning a response from inside one. Carries what was found, which is what the message says.
 */
class AssignmentHasWorkError extends Error {
  constructor(submissions: number, comments: number, grades: number) {
    const parts = [
      submissions > 0 ? 'submissions' : null,
      comments > 0 ? 'comments' : null,
      grades > 0 ? 'grades' : null,
    ].filter(Boolean);
    super(`Cannot delete assignment: ${parts.join(', ')} exist`);
  }
}

/**
 * Deletes an assignment, but only when it carries no student work at all: no submissions, no
 * comments and no grades. Grades count because they hang off the problem links this clears, so
 * an assignment holding only marks would take them with it. Course staff (faculty or TAs) or a
 * system admin.
 * @openapi
 * summary: Delete a course assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Assignment deleted. }
 *   400: { description: "Submissions, comments or grades exist." }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Assignment not found in this course. }
 *   500: { description: Server error. }
 */
export const DELETE = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { aid: id } = await ctx.params;

    const existing = await prisma.assignment.findFirst({
      where: { id, courseId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    try {
      /**
       * Grades count as work, and the guard has to still be true when the delete lands.
       *
       * Two problems lived here. Grades were never counted, and they cascade from the
       * assignment-problem links this deletes, so an assignment carrying nothing but manually
       * entered marks looked empty and took those marks with it. And the counts ran outside
       * any transaction, so a submission arriving after the count was deleted by a decision
       * taken before it existed.
       *
       * Both rows are locked first, because the work reaches the assignment by two different
       * paths: a comment points at the assignment, while a submission and a grade point at an
       * assignment-problem link. Locking only one of them leaves the other kind racing.
       */
      const deleted = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Assignment" WHERE "id" = ${id} FOR UPDATE`;
        await tx.$queryRaw`SELECT 1 FROM "AssignmentProblem" WHERE "assignmentId" = ${id} FOR UPDATE`;

        const [submissionCount, commentCount, gradeCount] = await Promise.all([
          tx.submission.count({ where: { assignmentId: id } }),
          tx.comment.count({ where: { assignmentId: id } }),
          tx.assignmentProblemGrade.count({ where: { assignmentId: id } }),
        ]);
        if (submissionCount > 0 || commentCount > 0 || gradeCount > 0) {
          throw new AssignmentHasWorkError(submissionCount, commentCount, gradeCount);
        }

        await tx.assignmentProblem.deleteMany({ where: { assignmentId: id } });
        return tx.assignment.delete({ where: { id } });
      });

      try {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'DELETE_ASSIGNMENT',
          severity: 'INFO',
          category: 'ASSIGNMENT',
          courseId,
          assignmentId: id,
          metadata: {
            userId: user.id,
            courseId,
            assignmentId: id,
            title: deleted.title,
          },
        });
      } catch (logErr) {
        console.error('Failed to write activity log for assignment deletion', logErr);
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      if (error instanceof AssignmentHasWorkError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      console.error('Assignment delete failed:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_DELETE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: id,
        error,
      });
      return NextResponse.json({ error: 'Failed to delete assignment' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_DELETE_DENIED', blockWhenArchived: true },
);
