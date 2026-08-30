import { NextResponse } from 'next/server';
import fs from 'fs';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withAssignmentAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { descriptionWriteData } from '@/lib/description-write';
import { AssignmentDuplicateApiSchema } from '@/schemas/assignment';
import {
  assignmentProblemSelect,
  attachCopiedProblems,
  copyAnswerKeysForProblems,
  type CopiedAnswerKey,
} from '@/lib/problem-copy';

type RouteCtx = { params: Promise<{ id: string; aid: string }> };

/**
 * Duplicate an assignment within the same course. The title/description come from the
 * request; the type (groupSetId), audience (AssignmentAssignee), schedule, and date
 * exceptions (AssignmentOverride) are copied verbatim from the source and are editable
 * afterward. The copy is always created unpublished. Submissions and grades are never
 * copied.
 *
 * Problems are handled by `problemMode`:
 *   - none      : the copy has no problems.
 *   - link      : the copy shares the source's Problem records (editing one edits both).
 *   - duplicate : each problem is copied to a new Problem (with its own solution file).
 *
 * @openapi
 * summary: Duplicate an assignment
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: aid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [title, problemMode]
 *         properties:
 *           title: { type: string }
 *           description: { type: string, nullable: true }
 *           problemMode: { type: string, enum: [none, link, duplicate] }
 * responses:
 *   201: { description: The newly created (unpublished) assignment. }
 *   400: { description: Invalid body. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Source assignment not found in this course. }
 *   500: { description: Server error. }
 */
export const POST = withAssignmentAuth(
  async (req, _ctx: RouteCtx, { user, courseId, assignment }) => {
    // Solution files copied for `duplicate` mode, tracked so a later failure can unlink
    // them (the DB transaction below never runs partial). Populated before the tx.
    const copiedSolutionFiles: string[] = [];

    try {
      const parsed = await readJson(req, AssignmentDuplicateApiSchema);
      if (!parsed.ok) return parsed.response;
      const { title, description, descriptionJson, problemMode } = parsed.data;

      // The wrapper already confirmed this assignment belongs to `courseId`.
      const source = await prisma.assignment.findFirst({
        where: { id: assignment.id, courseId },
        select: {
          id: true,
          ltiAutoSync: true,
          dueDate: true,
          unlockAt: true,
          assignedToEveryone: true,
          allowLateSubmissions: true,
          lateCutoff: true,
          groupSetId: true,
          assignees: { select: { targetType: true, userId: true, groupId: true } },
          overrides: {
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
          problems: { select: { problemId: true, ...assignmentProblemSelect } },
        },
      });
      if (!source) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      // Copied before the DB transaction so the transaction is pure database writes and a
      // failure can unlink whatever was already written. See `copyAnswerKeysForProblems`.
      const solutionByProblemId = new Map<string, CopiedAnswerKey>();
      if (problemMode === 'duplicate') {
        const copied = await copyAnswerKeysForProblems(source.problems.map((link) => link.problem));
        for (const [id, key] of copied.byProblemId) solutionByProblemId.set(id, key);
        copiedSolutionFiles.push(...copied.copiedPaths);
      }

      const created = await prisma.$transaction(async (tx) => {
        const dup = await tx.assignment.create({
          data: {
            title,
            // The dialog can edit the title/description, so the request body wins here. When
            // it sends rich JSON the plain text is derived from it; otherwise this is a
            // plain-text write. Callers that omit both get the same null as before.
            ...descriptionWriteData({ description, descriptionJson }),
            dueDate: source.dueDate,
            unlockAt: source.unlockAt,
            assignedToEveryone: source.assignedToEveryone,
            allowLateSubmissions: source.allowLateSubmissions,
            lateCutoff: source.lateCutoff,
            // Whether grades go to the LMS is a choice about this assignment, so the copy
            // keeps it. Left out, a copy of an assignment with sync deliberately off came
            // back with it on, and a linked course would start publishing its grades.
            ltiAutoSync: source.ltiAutoSync,
            // Always unpublished, regardless of the source's publish state.
            isPublished: false,
            groupSetId: source.groupSetId,
            courseId,
          },
        });

        // Audience (WHO): copy the assignee rows as-is (same course, so ids stay valid).
        if (source.assignees.length > 0) {
          await tx.assignmentAssignee.createMany({
            data: source.assignees.map((a) => ({
              assignmentId: dup.id,
              targetType: a.targetType,
              userId: a.userId,
              groupId: a.groupId,
            })),
          });
        }

        // Date exceptions (WHEN): copy the overrides. The duplicating user is recorded as
        // their creator.
        if (source.overrides.length > 0) {
          await tx.assignmentOverride.createMany({
            data: source.overrides.map((o) => ({
              assignmentId: dup.id,
              targetType: o.targetType,
              userId: o.userId,
              groupId: o.groupId,
              unlockAt: o.unlockAt,
              dueDate: o.dueDate,
              lateCutoff: o.lateCutoff,
              allowLateSubmissions: o.allowLateSubmissions,
              createdById: user.id,
            })),
          });
        }

        // Problems, per the chosen mode.
        if (problemMode === 'link' && source.problems.length > 0) {
          await tx.assignmentProblem.createMany({
            data: source.problems.map((l) => ({
              assignmentId: dup.id,
              problemId: l.problemId,
              maxPoints: l.maxPoints,
              maxSubmissions: l.maxSubmissions,
              autograderEnabled: l.autograderEnabled,
            })),
          });
        } else if (problemMode === 'duplicate') {
          await attachCopiedProblems(tx, {
            links: source.problems,
            assignmentId: dup.id,
            courseId,
            answerKeys: solutionByProblemId,
          });
        }
        // 'none': no problem links.

        return dup;
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'DUPLICATE_ASSIGNMENT',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: created.id,
        metadata: {
          userId: user.id,
          courseId,
          sourceAssignmentId: source.id,
          newAssignmentId: created.id,
          title: created.title,
          problemMode,
          problemCount: source.problems.length,
          assigneeCount: source.assignees.length,
          overrideCount: source.overrides.length,
        },
      });

      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      // The transaction is all-or-nothing, so on failure the only side effect to undo is
      // the solution files copied up front.
      await Promise.all(
        copiedSolutionFiles.map((f) => fs.promises.unlink(f).catch(() => undefined)),
      );
      console.error('Assignment duplication failed:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_DUPLICATE_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        error,
      });
      return NextResponse.json({ error: 'Failed to duplicate assignment' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_DUPLICATE_DENIED', blockWhenArchived: true },
);
