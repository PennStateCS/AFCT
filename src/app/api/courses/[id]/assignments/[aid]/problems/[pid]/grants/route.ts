import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withCourseAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { SubmissionGrantCreateApiSchema } from '@/schemas/assignment';

type Ctx = { params: Promise<{ id: string; aid: string; pid: string }> };

// The problem link, scoped through the course so a foreign id can never resolve.
async function loadProblemLink(courseId: string, aid: string, pid: string) {
  return prisma.assignmentProblem.findFirst({
    where: { assignmentId: aid, problemId: pid, assignment: { courseId } },
    select: {
      maxSubmissions: true,
      assignment: { select: { groupSetId: true, assignedToEveryone: true } },
    },
  });
}

/**
 * Lists the extra-submission grants for one assignment problem. Course staff (faculty or
 * TAs) or a system admin.
 * @openapi
 * summary: List a problem's extra-submission grants
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: The problem's grants (newest first). }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Problem not found in this assignment. }
 *   500: { description: Server error. }
 */
export const GET = withCourseAuth(
  async (_req, ctx: Ctx, { courseId }) => {
    const { aid, pid } = await ctx.params;
    const link = await loadProblemLink(courseId, aid, pid);
    if (!link) {
      return NextResponse.json({ error: 'Problem not found in this assignment' }, { status: 404 });
    }
    const grants = await prisma.submissionGrant.findMany({
      where: { assignmentId: aid, problemId: pid },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        studentGroup: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(grants);
  },
  { access: 'manage', deniedAction: 'SUBMISSION_GRANTS_ACCESS_DENIED' },
);

/**
 * Grants extra submissions to one student or group on this problem, on top of the
 * problem's shared cap. Repeat grants to the same target accumulate onto one row. Course
 * staff (faculty or TAs) or a system admin.
 * @openapi
 * summary: Grant extra submissions to a student or group
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [extraSubmissions]
 *         properties:
 *           userId: { type: string, description: Target student (exactly one of userId/groupId). }
 *           groupId: { type: string, description: Target group (exactly one of userId/groupId). }
 *           extraSubmissions: { type: integer, minimum: 1, maximum: 100 }
 *           reason: { type: string, description: Optional note shown to staff. }
 * responses:
 *   201: { description: The grant row (with the accumulated total). }
 *   400: { description: Invalid target or an unlimited problem. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Problem not found in this assignment. }
 *   409: { description: Course archived or a concurrent grant conflicted. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx: Ctx, { user, courseId }) => {
    const { aid, pid } = await ctx.params;
    try {
      const link = await loadProblemLink(courseId, aid, pid);
      if (!link) {
        return NextResponse.json(
          { error: 'Problem not found in this assignment' },
          { status: 404 },
        );
      }

      const parsed = await readJson(req, SubmissionGrantCreateApiSchema);
      if (!parsed.ok) return parsed.response;
      const data = parsed.data;

      // A grant adds to a finite cap; on an unlimited problem it would change nothing,
      // so refuse it rather than record a no-op the UI would then have to explain.
      if (link.maxSubmissions <= 0) {
        return NextResponse.json(
          { error: 'This problem allows unlimited submissions; a grant would change nothing.' },
          { status: 400 },
        );
      }

      const isGroupAssignment = link.assignment.groupSetId != null;
      const invalidTarget = async (targetMeta: Record<string, string>, message: string) => {
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'SUBMISSION_GRANT_TARGET_INVALID',
          severity: 'SECURITY',
          category: 'ASSIGNMENT',
          courseId,
          assignmentId: aid,
          problemId: pid,
          metadata: targetMeta,
        });
        return NextResponse.json({ error: message }, { status: 400 });
      };

      // A group can only be granted on a group assignment. A student may be granted on
      // either kind: on a group assignment the higher cap follows that member's own
      // submit action, while a group grant raises it for every member.
      if (!isGroupAssignment && data.groupId) {
        return invalidTarget(
          { reason: 'group target on an individual assignment' },
          'This is an individual assignment; grant to a student, not a group.',
        );
      }

      let grant;
      if (data.groupId) {
        // ── GROUP target: a group in this assignment's set that is assigned it ──
        const group = await prisma.studentGroup.findFirst({
          where: { id: data.groupId, groupSetId: link.assignment.groupSetId ?? undefined },
          select: { id: true },
        });
        if (!group) {
          return invalidTarget(
            { targetGroupId: data.groupId, reason: "group not in this assignment's set" },
            "Target group is not in this assignment's group set.",
          );
        }
        if (!link.assignment.assignedToEveryone) {
          const assigned = await prisma.assignmentAssignee.findFirst({
            where: { assignmentId: aid, groupId: group.id },
            select: { id: true },
          });
          if (!assigned) {
            return invalidTarget(
              { targetGroupId: group.id, reason: 'group not assigned this assignment' },
              'That group is not assigned this assignment.',
            );
          }
        }

        try {
          grant = await prisma.submissionGrant.upsert({
            where: {
              assignmentId_problemId_groupId: {
                assignmentId: aid,
                problemId: pid,
                groupId: group.id,
              },
            },
            create: {
              targetType: 'GROUP',
              assignmentId: aid,
              problemId: pid,
              groupId: group.id,
              extraSubmissions: data.extraSubmissions,
              reason: data.reason ?? null,
              createdById: user.id,
            },
            update: {
              extraSubmissions: { increment: data.extraSubmissions },
              ...(data.reason ? { reason: data.reason } : {}),
              createdById: user.id,
            },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return NextResponse.json(
              { error: 'A concurrent grant conflicted; please retry.' },
              { status: 409 },
            );
          }
          throw err;
        }
      } else {
        // ── STUDENT target: an active student who is assigned this assignment ──
        const userId = data.userId as string;
        const rosterEntry = await prisma.roster.findUnique({
          where: { courseId_userId: { courseId, userId } },
          select: { role: true, status: true },
        });
        if (!rosterEntry || rosterEntry.role !== 'STUDENT' || rosterEntry.status === 'DROPPED') {
          return invalidTarget(
            { targetUserId: userId, reason: 'not an active student on the roster' },
            'Target must be a student enrolled in this course.',
          );
        }
        if (!link.assignment.assignedToEveryone) {
          // Assigned directly, or through a group of theirs on a group assignment.
          const assigned = await prisma.assignmentAssignee.findFirst({
            where: {
              assignmentId: aid,
              OR: [{ userId }, { studentGroup: { memberships: { some: { userId } } } }],
            },
            select: { id: true },
          });
          if (!assigned) {
            return invalidTarget(
              { targetUserId: userId, reason: 'student not assigned this assignment' },
              'That student is not assigned this assignment.',
            );
          }
        }

        try {
          grant = await prisma.submissionGrant.upsert({
            where: {
              assignmentId_problemId_userId: { assignmentId: aid, problemId: pid, userId },
            },
            create: {
              targetType: 'STUDENT',
              assignmentId: aid,
              problemId: pid,
              userId,
              extraSubmissions: data.extraSubmissions,
              reason: data.reason ?? null,
              createdById: user.id,
            },
            update: {
              extraSubmissions: { increment: data.extraSubmissions },
              ...(data.reason ? { reason: data.reason } : {}),
              createdById: user.id,
            },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            return NextResponse.json(
              { error: 'A concurrent grant conflicted; please retry.' },
              { status: 409 },
            );
          }
          throw err;
        }
      }

      // A privileged change to a student's submission limit: record actor, target,
      // problem, this grant's amount, and the accumulated total.
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'GRANT_EXTRA_SUBMISSIONS',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        problemId: pid,
        metadata: {
          grantId: grant.id,
          targetUserId: grant.userId,
          targetGroupId: grant.groupId,
          targetType: grant.targetType,
          extraSubmissions: data.extraSubmissions,
          totalExtraSubmissions: grant.extraSubmissions,
          reason: data.reason ?? null,
        },
      });

      return NextResponse.json(grant, { status: 201 });
    } catch (error) {
      console.error('POST submission grant error:', error);
      await logError(req, {
        userId: user.id,
        action: 'SUBMISSION_GRANT_CREATE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: aid,
        error,
      });
      return NextResponse.json({ error: 'Failed to grant extra submissions' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'SUBMISSION_GRANT_CREATE_DENIED', blockWhenArchived: true },
);
