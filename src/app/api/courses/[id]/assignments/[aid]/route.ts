import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { prisma } from '@/lib/prisma';
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
import { toEndOfDayInTimezone } from '@/lib/date-utils';
import { computeLateSubmissionState, resolveUnlockAt } from '@/lib/assignment-late-window';
import { effectiveDeadline } from '@/lib/effective-deadline';
import { overridesForStudentWhere } from '@/lib/assignment-visibility';

// Types
interface AssignmentWithProblemsAndCourse {
  problems: {
    problem: {
      id: string;
      title: string;
      description: string | null;
      type: z.infer<typeof ProblemTypeEnum> | null;
      maxStates: number | null;
      isDeterministic: boolean | null;
      fileName: string | null;
      originalFileName: string | null;
    };
    maxPoints: number;
    maxSubmissions: number;
    autograderEnabled: boolean;
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
 * State-integrity guards shared by the full (PUT) and partial (PATCH) updates: an
 * assignment can't be unpublished once it has submissions or grades. Returns a
 * `NextResponse` to short-circuit the update, or `null` when the change is allowed.
 */
async function assertAssignmentMutable(
  req: Request,
  params: {
    userId: string;
    courseId: string;
    assignmentId: string | undefined;
    data: { isPublished?: boolean };
  },
): Promise<NextResponse | null> {
  const { userId, courseId, assignmentId, data } = params;

  // `data.isPublished` is the requested NEXT state, so `=== false` means "unpublish".
  // Block unpublishing an assignment that already has submissions or grades.
  if (data.isPublished === false) {
    const hasSubmission = !!(await prisma.assignmentProblem.findFirst({
      where: { assignmentId, submissions: { some: {} } },
      select: { assignmentId: true },
    }));
    const hasGrade = !!(await prisma.assignmentProblemGrade.findFirst({
      where: { assignmentId },
      select: { assignmentId: true },
    }));

    if (hasSubmission) {
      await createEnhancedActivityLog(prisma, req, {
        userId,
        action: 'ASSIGNMENT_UNPUBLISH_REJECTED',
        category: 'ASSIGNMENT',
        severity: 'WARNING',
        courseId,
        assignmentId,
        metadata: { reason: 'has submissions' },
      });
      return NextResponse.json({ error: 'Assignment must not have any submissions' }, { status: 403 });
    }

    if (hasGrade) {
      await createEnhancedActivityLog(prisma, req, {
        userId,
        action: 'ASSIGNMENT_UNPUBLISH_REJECTED',
        category: 'ASSIGNMENT',
        severity: 'WARNING',
        courseId,
        assignmentId,
        metadata: { reason: 'has grades' },
      });
      return NextResponse.json({ error: 'Assignment must not have any grades' }, { status: 403 });
    }
  }

  return null;
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
              problem: {
                select: {
                  id: true,
                  title: true,
                  description: true,
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
        description: locked ? null : av.description,
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

    const mutationBlock = await assertAssignmentMutable(req, {
      userId: user.id,
      courseId,
      assignmentId: id,
      data,
    });
    if (mutationBlock) return mutationBlock;

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

      const updated = await prisma.assignment.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          // Use the computed value (keeps the existing due date when none was sent)
          // rather than re-deriving from a possibly-undefined data.dueDate.
          dueDate,
          unlockAt: unlockState.unlockAt,
          allowLateSubmissions,
          lateCutoff,
          isPublished: data.isPublished,
        },
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

    const mutationBlock = await assertAssignmentMutable(req, {
      userId: user.id,
      courseId,
      assignmentId: id,
      data,
    });
    if (mutationBlock) return mutationBlock;

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
        description?: string;
        dueDate?: Date;
        unlockAt?: Date | null;
        allowLateSubmissions?: boolean;
        lateCutoff?: Date | null;
        isPublished?: boolean;
      } = {};

      if (data.title !== undefined) updateData.title = data.title;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.dueDate !== undefined) updateData.dueDate = effectiveDueDate;
      if (unlockState.changed) updateData.unlockAt = unlockState.unlockAt;
      if (data.allowLateSubmissions !== undefined) {
        updateData.allowLateSubmissions = allowLateSubmissions;
      }
      if (data.lateCutoff !== undefined) updateData.lateCutoff = lateCutoff;
      if (data.isPublished !== undefined) updateData.isPublished = data.isPublished;

      const updated = await prisma.assignment.update({
        where: { id },
        data: updateData,
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
          changedFields: Object.keys(updateData),
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
 * Deletes an assignment, but only when it's safe: no submissions and no comments. Its
 * problem links are cleared first, then the assignment is removed. Course staff
 * (faculty or TAs) or a system admin.
 * @openapi
 * summary: Delete a course assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Assignment deleted. }
 *   400: { description: Submissions or comments exist. }
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
      // Confirm it's safe to delete: no submissions and no comments.
      const submissionCount = await prisma.submission.count({ where: { assignmentId: id } });
      if (submissionCount > 0) {
        return NextResponse.json(
          { error: 'Cannot delete assignment: submissions exist' },
          { status: 400 },
        );
      }

      const commentCount = await prisma.comment.count({ where: { assignmentId: id } });
      if (commentCount > 0) {
        return NextResponse.json(
          { error: 'Cannot delete assignment: comments exist' },
          { status: 400 },
        );
      }

      // Safe to delete: remove AssignmentProblem links first, then the assignment.
      await prisma.assignmentProblem.deleteMany({ where: { assignmentId: id } });
      const deleted = await prisma.assignment.delete({ where: { id } });

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
