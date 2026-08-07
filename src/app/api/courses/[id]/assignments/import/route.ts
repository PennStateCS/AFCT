import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logDenial, logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { canManageCourse } from '@/lib/permissions';
import { readJson } from '@/lib/api/request';
import { safeStoredFilename, resolveInsideDir } from '@/lib/safe-upload';
import { descriptionWriteData, descriptionCopyData } from '@/lib/description-write';
import { AssignmentImportApiSchema } from '@/schemas/assignment';

// Solution files live here (same as the problem upload / duplicate paths).
const solutionsDir = path.join('/private', 'uploads', 'solutions');

/**
 * Imports an assignment from ANOTHER course the caller can manage into this course.
 * Unlike duplicate, audience, group set, and date exceptions are not carried across
 * (they reference records scoped to the source course); the import always lands as an
 * unpublished, individual, assigned-to-everyone assignment. The schedule (due date,
 * available-from, late settings) is copied from the source as a starting point and is
 * editable afterward.
 *
 * Problems are handled by `problemMode`:
 *   - none : the imported assignment has no problems.
 *   - copy : each problem is copied into THIS course (a new Problem with its own
 *            solution file); there is no "link" mode because problems are course-scoped.
 *
 * Permission is tiered: the wrapper gates the destination course (manage), and the
 * caller must also be able to manage the source course.
 *
 * @openapi
 * summary: Import an assignment from another course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string }, description: Destination course id }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [sourceCourseId, sourceAssignmentId, title, problemMode]
 *         properties:
 *           sourceCourseId: { type: string }
 *           sourceAssignmentId: { type: string }
 *           title: { type: string }
 *           description: { type: string, nullable: true }
 *           problemMode: { type: string, enum: [none, copy] }
 * responses:
 *   201: { description: The newly created (unpublished) assignment. }
 *   400: { description: "Invalid body, or the source is the destination course." }
 *   403: { description: Caller cannot manage the destination or the source course. }
 *   404: { description: Source assignment not found in the source course. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    // Solution files copied for `copy` mode, tracked so a later failure can unlink them
    // (the DB transaction never runs partial). Populated before the transaction.
    const copiedSolutionFiles: string[] = [];

    try {
      const parsed = await readJson(req, AssignmentImportApiSchema);
      if (!parsed.ok) return parsed.response;
      const { sourceCourseId, sourceAssignmentId, title, description, descriptionJson, problemMode } =
        parsed.data;

      // Importing from the same course is what Duplicate is for; reject it here so the
      // two flows stay distinct (audience would otherwise be silently reset).
      if (sourceCourseId === courseId) {
        return NextResponse.json(
          { error: 'Use Duplicate to copy an assignment within the same course.' },
          { status: 400 },
        );
      }

      // The wrapper gated the DESTINATION course; the caller must also be staff (or an
      // admin) in the SOURCE course to read and import from it.
      if (!(await canManageCourse(user, sourceCourseId))) {
        return logDenial(req, {
          userId: user.id,
          action: 'ASSIGNMENT_IMPORT_DENIED',
          category: 'ASSIGNMENT',
          courseId,
          metadata: { sourceCourseId, sourceAssignmentId },
        });
      }

      const source = await prisma.assignment.findFirst({
        where: { id: sourceAssignmentId, courseId: sourceCourseId },
        select: {
          id: true,
          dueDate: true,
          unlockAt: true,
          allowLateSubmissions: true,
          lateCutoff: true,
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
                  descriptionFormat: true,
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
        },
      });
      if (!source) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      // Copy each problem's solution file to a fresh name BEFORE the DB transaction, so
      // the transaction is pure DB writes and a failure can unlink what was copied.
      // Keyed by source problem id -> {fileName, originalFileName} for the new Problem.
      const solutionByProblemId = new Map<
        string,
        { fileName: string | null; originalFileName: string | null }
      >();
      if (problemMode === 'copy') {
        for (const link of source.problems) {
          const p = link.problem;
          const originalFileName = p.originalFileName ?? null;
          if (!p.fileName) {
            solutionByProblemId.set(p.id, { fileName: null, originalFileName });
            continue;
          }
          const src = resolveInsideDir(solutionsDir, p.fileName);
          if (!fs.existsSync(src)) {
            solutionByProblemId.set(p.id, { fileName: null, originalFileName });
            continue;
          }
          const newName = safeStoredFilename(p.originalFileName ?? p.fileName);
          const dest = resolveInsideDir(solutionsDir, newName);
          await fs.promises.copyFile(src, dest);
          copiedSolutionFiles.push(dest);
          solutionByProblemId.set(p.id, { fileName: newName, originalFileName });
        }
      }

      const created = await prisma.$transaction(async (tx) => {
        const imported = await tx.assignment.create({
          data: {
            title,
            // Title/description are editable in the import dialog, so the body wins; rich
            // JSON (when sent) is authoritative and the plain text is derived from it.
            ...descriptionWriteData({ description, descriptionJson }),
            // Schedule copied from the source as a starting point (may be from another
            // term); the importer reviews it before publishing.
            dueDate: source.dueDate,
            unlockAt: source.unlockAt,
            allowLateSubmissions: source.allowLateSubmissions,
            lateCutoff: source.lateCutoff,
            // Reset for the new course: unpublished, individual, everyone. Audience,
            // group set, and overrides reference the source course and are not carried.
            isPublished: false,
            assignedToEveryone: true,
            groupSetId: null,
            courseId,
          },
        });

        if (problemMode === 'copy') {
          for (const l of source.problems) {
            const p = l.problem;
            const sol = solutionByProblemId.get(p.id) ?? {
              fileName: null,
              originalFileName: p.originalFileName ?? null,
            };
            const newProblem = await tx.problem.create({
              data: {
                title: p.title,
                // Carry the rich description verbatim so a copy is not silently downgraded.
                ...descriptionCopyData(p),
                type: p.type,
                maxStates: p.maxStates,
                isDeterministic: p.isDeterministic,
                fileName: sol.fileName,
                originalFileName: sol.originalFileName,
                courseId,
              },
            });
            await tx.assignmentProblem.create({
              data: {
                assignmentId: imported.id,
                problemId: newProblem.id,
                maxPoints: l.maxPoints,
                maxSubmissions: l.maxSubmissions,
                autograderEnabled: l.autograderEnabled,
              },
            });
          }
        }

        return imported;
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'IMPORT_ASSIGNMENT',
        severity: 'INFO',
        category: 'ASSIGNMENT',
        courseId,
        assignmentId: created.id,
        metadata: {
          userId: user.id,
          courseId,
          sourceCourseId,
          sourceAssignmentId: source.id,
          newAssignmentId: created.id,
          title: created.title,
          problemMode,
          problemCount: source.problems.length,
        },
      });

      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      // The transaction is all-or-nothing, so on failure the only side effect to undo is
      // the solution files copied up front.
      await Promise.all(
        copiedSolutionFiles.map((f) => fs.promises.unlink(f).catch(() => undefined)),
      );
      console.error('Assignment import failed:', error);
      await logError(req, {
        userId: user.id,
        action: 'ASSIGNMENT_IMPORT_ERROR',
        category: 'ASSIGNMENT',
        courseId,
        error,
      });
      return NextResponse.json({ error: 'Failed to import assignment' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'ASSIGNMENT_IMPORT_DENIED', blockWhenArchived: true },
);
