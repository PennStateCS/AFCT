import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { withCourseAuth } from '@/lib/api/with-auth';
import { safeStoredFilename, resolveInsideDir } from '@/lib/safe-upload';
import { descriptionWriteData } from '@/lib/description-write';
import { readJson } from '@/lib/api/request';
import { ProblemDuplicateApiSchema } from '@/schemas/problem';

// Solution files live here; the URL to serve them is /api/files/solutions/[file].
const uploadsDir = path.join('/private', 'uploads', 'solutions');

/**
 * Duplicate a problem within the same course. The title/description come from the
 * request; the type, state cap, determinism flag, and the solution file (answer key) are
 * copied from the source and stay editable afterward. The solution file is copied to a
 * fresh name on disk so the two problems never share a file.
 *
 * @openapi
 * summary: Duplicate a course problem
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [title]
 *         properties:
 *           title: { type: string }
 *           description: { type: string, nullable: true }
 * responses:
 *   201: { description: The newly created problem. }
 *   400: { description: Invalid body. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Source problem not found in this course. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { pid: problemId } = await ctx.params;
    // The solution file copied before the DB write, so a failed create can unlink it.
    let copiedFile: string | null = null;
    try {
      const source = await prisma.problem.findFirst({ where: { id: problemId, courseId } });
      if (!source) {
        return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
      }

      const parsed = await readJson(req, ProblemDuplicateApiSchema);
      if (!parsed.ok) return parsed.response;
      const { title, description, descriptionJson } = parsed.data;

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
        action: 'DUPLICATE_PROBLEM',
        severity: 'INFO',
        category: 'PROBLEM',
        courseId,
        problemId: created.id,
        metadata: {
          userId: user.id,
          courseId,
          sourceProblemId: source.id,
          newProblemId: created.id,
          title: created.title,
          copiedFile: !!newFileName,
        },
      });

      return NextResponse.json(created, { status: 201 });
    } catch (err) {
      console.error('Problem duplication error:', err);
      await logError(req, {
        userId: user.id,
        action: 'PROBLEM_DUPLICATE_ERROR',
        category: 'PROBLEM',
        courseId,
        problemId,
        error: err,
      });
      return NextResponse.json({ error: 'Failed to duplicate problem' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_DUPLICATE_DENIED', blockWhenArchived: true },
);
