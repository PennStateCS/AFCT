import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logDenial, logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { canManageCourse } from '@/lib/permissions';
import { safeStoredFilename, resolveInsideDir } from '@/lib/safe-upload';
import { descriptionWriteData } from '@/lib/description-write';
import { readJson } from '@/lib/api/request';
import { ProblemImportApiSchema } from '@/schemas/problem';

// Solution files live here; the URL to serve them is /api/files/solutions/[file].
const uploadsDir = path.join('/private', 'uploads', 'solutions');

/**
 * Imports a problem from ANOTHER course the caller can manage into this course. The
 * title/description come from the request; the type, state cap, determinism flag, and
 * the solution file (answer key) are copied from the source. The solution file is copied
 * to a fresh name on disk so the two problems never share a file.
 *
 * Permission is tiered: the wrapper gates the destination course (manage), and the caller
 * must also be able to manage the source course.
 *
 * @openapi
 * summary: Import a problem from another course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string }, description: Destination course id }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [sourceCourseId, sourceProblemId, title]
 *         properties:
 *           sourceCourseId: { type: string }
 *           sourceProblemId: { type: string }
 *           title: { type: string }
 *           description: { type: string, nullable: true }
 * responses:
 *   201: { description: The newly created problem. }
 *   400: { description: "Invalid body, or the source is the destination course." }
 *   403: { description: Caller cannot manage the destination or the source course. }
 *   404: { description: Source problem not found in the source course. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    // The solution file copied before the DB write, so a failed create can unlink it.
    let copiedFile: string | null = null;
    try {
      const parsed = await readJson(req, ProblemImportApiSchema);
      if (!parsed.ok) return parsed.response;
      const { sourceCourseId, sourceProblemId, title, description, descriptionJson } = parsed.data;

      // Importing from the same course is what Duplicate is for; reject it here so the
      // two flows stay distinct.
      if (sourceCourseId === courseId) {
        return NextResponse.json(
          { error: 'Use Duplicate to copy a problem within the same course.' },
          { status: 400 },
        );
      }

      // The wrapper gated the DESTINATION course; the caller must also be staff (or an
      // admin) in the SOURCE course to read and import from it.
      if (!(await canManageCourse(user, sourceCourseId))) {
        return logDenial(req, {
          userId: user.id,
          action: 'PROBLEM_IMPORT_DENIED',
          category: 'PROBLEM',
          courseId,
          metadata: { sourceCourseId, sourceProblemId },
        });
      }

      const source = await prisma.problem.findFirst({
        where: { id: sourceProblemId, courseId: sourceCourseId },
      });
      if (!source) {
        return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
      }

      // Copy the answer-key file to a new name, if the source has one and it's on disk.
      let newFileName: string | null = null;
      if (source.fileName) {
        const src = resolveInsideDir(uploadsDir, source.fileName);
        if (fs.existsSync(src)) {
          newFileName = safeStoredFilename(source.originalFileName ?? source.fileName);
          const dest = resolveInsideDir(uploadsDir, newFileName);
          await fs.promises.copyFile(src, dest);
          copiedFile = dest;
        }
      }

      let created;
      try {
        created = await prisma.problem.create({
          data: {
            title,
            // The dialog can edit the description, so the body wins; rich JSON (when sent)
            // is authoritative and the plain text is derived from it.
            ...descriptionWriteData({ description, descriptionJson }),
            type: source.type,
            maxStates: source.maxStates,
            isDeterministic: source.isDeterministic,
            fileName: newFileName,
            // Only carry the display name when a file was actually copied.
            originalFileName: newFileName ? (source.originalFileName ?? null) : null,
            courseId,
          },
        });
      } catch (dbErr) {
        // The new row was not created, so the copied file would be orphaned; remove it.
        if (copiedFile) {
          await fs.promises.unlink(copiedFile).catch(() => undefined);
        }
        throw dbErr;
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'IMPORT_PROBLEM',
        severity: 'INFO',
        category: 'PROBLEM',
        courseId,
        problemId: created.id,
        metadata: {
          userId: user.id,
          courseId,
          sourceCourseId,
          sourceProblemId: source.id,
          newProblemId: created.id,
          title: created.title,
          copiedFile: !!newFileName,
        },
      });

      return NextResponse.json(created, { status: 201 });
    } catch (err) {
      console.error('Problem import error:', err);
      await logError(req, {
        userId: user.id,
        action: 'PROBLEM_IMPORT_ERROR',
        category: 'PROBLEM',
        courseId,
        error: err,
      });
      return NextResponse.json({ error: 'Failed to import problem' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_IMPORT_DENIED', blockWhenArchived: true },
);
