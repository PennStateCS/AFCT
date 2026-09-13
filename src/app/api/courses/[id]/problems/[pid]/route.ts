import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import type { ProblemType } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';
import { withCourseAuth } from '@/lib/api/with-auth';
import { safeStoredFilename, resolveInsideDir } from '@/lib/safe-upload';
import { submissionContentHash, submissionShapeHash } from '@/lib/similarity/content-hash';
import { readFormData } from '@/lib/api/request';
import { descriptionWriteData } from '@/lib/description-write';
import {
  ProblemUpdateApiSchema,
  ALLOWED_PROBLEM_EXTENSIONS,
  isAllowedProblemExtension,
} from '@/schemas/problem';

// Solution files live here; the URL to serve them is /api/files/solutions/[file].
const uploadsDir = path.join('/private', 'uploads', 'solutions');

/**
 * Updates a problem within a course (multipart/form-data). Course staff (faculty or
 * TAs) or a system admin. The problem must belong to the course in the path. Sending a
 * new file replaces the stored solution; it's structure-validated and size-checked
 * first, and the previous file is removed. Omitting the file keeps the current one.
 * @openapi
 * summary: Update a course problem
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         required: [title, type]
 *         properties:
 *           title: { type: string }
 *           description: { type: string }
 *           type: { type: string }
 *           maxStates: { type: string }
 *           isDeterministic: { type: string, enum: ['true', 'false'] }
 *           file: { type: string, format: binary, description: Optional new solution file }
 * responses:
 *   200: { description: The updated problem. }
 *   400: { description: Missing fields or the new file failed structure validation. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: Problem not found in this course. }
 *   413: { description: File exceeds the system upload limit. }
 *   500: { description: Server error. }
 */
export const PUT = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { pid: problemId } = await ctx.params;
    try {
      // The problem must belong to the course in the path.
      const existingProblem = await prisma.problem.findFirst({
        where: { id: problemId, courseId },
      });
      if (!existingProblem) {
        return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
      }

      // Validate the scalar fields server-side (title, type, coerced numbers/bools).
      const parsed = await readFormData(req, ProblemUpdateApiSchema);
      if (!parsed.ok) return parsed.response;
      const data = parsed.data;
      const { title, type } = data;
      const assignmentId = data.assignmentId;
      const file = parsed.form.get('file') as File | null;

      let fileName = existingProblem.fileName;
      let originalFileName = existingProblem.originalFileName;
      // The previous solution file, kept until the database update commits.
      let replacedFileName: string | null = null;
      // Left undefined unless a new answer file arrives, so an edit that only changes the
      // title does not blank the fingerprints.
      let answerContentHash: string | null | undefined;
      let answerShapeHash: string | null | undefined;

      /**
       * Changing the type has to answer for the answer file already there.
       *
       * Validation only ever ran on an upload, so a problem could be switched from FA to PDA
       * while keeping its FA answer. The row then claimed one thing and its answer key was
       * another, and the evaluator would be asked to mark student work against it.
       *
       * A stored answer that happens to satisfy the new type is allowed through, which is why
       * this re-reads rather than refusing outright. One that does not, or that cannot be read
       * at all, means the type change needs a new answer file to come with it.
       */
      const typeChanged = type !== existingProblem.type;
      const keepingExistingFile = !(file && file.size > 0);
      if (typeChanged && keepingExistingFile && existingProblem.fileName) {
        let existingXml: string | null = null;
        try {
          existingXml = await fs.promises.readFile(
            resolveInsideDir(uploadsDir, existingProblem.fileName),
            'utf8',
          );
        } catch {
          existingXml = null;
        }

        const stillValid = existingXml !== null && validateStructureXML(existingXml, type).isValid;
        if (!stillValid) {
          await createEnhancedActivityLog(prisma, req, {
            userId: user.id,
            action: 'PROBLEM_TYPE_CHANGE_REFUSED',
            severity: 'WARNING',
            category: 'PROBLEM',
            courseId,
            problemId,
            metadata: {
              fromType: existingProblem.type,
              toType: type,
              reason:
                existingXml === null
                  ? 'answer file unreadable'
                  : 'answer file is not valid for the new type',
            },
          });
          return NextResponse.json(
            {
              error: `The answer file on this problem is not a valid ${type}. Upload a new answer file with the type change.`,
            },
            { status: 400 },
          );
        }
      }

      // Handle file update if a new file is provided
      if (file && file.size > 0) {
        // Enforce the solution-file extension allow-list server-side.
        if (!isAllowedProblemExtension(file.name)) {
          return NextResponse.json(
            { error: `Allowed file types: .${ALLOWED_PROBLEM_EXTENSIONS.join(', .')}` },
            { status: 400 },
          );
        }
        const { maxBytes, maxMb } = await getSystemUploadLimit();
        if (file.size > maxBytes) {
          return NextResponse.json(
            { error: `File exceeds max upload size (${maxMb} MB).` },
            { status: 413 },
          );
        }
        // One pass over the upload: these bytes serve both the XML check and the write.
        const buffer = Buffer.from(await file.arrayBuffer());
        const xml = buffer.toString('utf8');
        const validation = validateStructureXML(xml, type);
        if (!validation.isValid) {
          await createEnhancedActivityLog(prisma, req, {
            userId: user.id,
            action: 'PROBLEM_INVALID_FILE_STRUCTURE',
            severity: 'WARNING',
            category: 'PROBLEM',
            courseId,
            assignmentId,
            problemId,
            metadata: {
              userId: user.id,
              courseId,
              assignmentId,
              problemId,
              error: validation.error,
            },
          });

          return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        await fs.promises.mkdir(uploadsDir, { recursive: true });

        // Write the replacement FIRST, under its own random name, and leave the old
        // file alone until the database has committed. Deleting first meant a failed
        // update destroyed the answer key while the row still pointed at it.
        fileName = safeStoredFilename(file.name);
        originalFileName = file.name;
        // Re-fingerprint whenever the answer file is replaced; a stale hash would have the
        // Similarity tab calling a submission the posted answer after the answer changed.
        answerContentHash = submissionContentHash(buffer);
        answerShapeHash = submissionShapeHash(buffer);
        await fs.promises.writeFile(resolveInsideDir(uploadsDir, fileName), buffer, {
          mode: 0o644,
        });
        replacedFileName = existingProblem.fileName;
      }

      let updatedProblem;
      try {
        updatedProblem = await prisma.problem.update({
          where: { id: problemId },
          data: {
            title,
            ...descriptionWriteData(data),
            type: type as ProblemType,
            fileName,
            originalFileName,
            // Left out entirely when no new file arrived, so editing a title does not blank
            // the fingerprints.
            ...(answerContentHash !== undefined ? { answerContentHash, answerShapeHash } : {}),
            maxStates: ['FA', 'PDA'].includes(type) ? (data.maxStates ?? 0) || null : null,
            isDeterministic: type === 'FA' ? (data.isDeterministic ?? false) : null,
          },
        });
      } catch (dbErr) {
        // The row still references the old file, so roll back by removing the new one
        // rather than leaving it orphaned on disk.
        if (fileName && fileName !== existingProblem.fileName) {
          try {
            await fs.promises.unlink(resolveInsideDir(uploadsDir, fileName));
          } catch {
            // Best effort: a stray file is preferable to masking the real error.
          }
        }
        throw dbErr;
      }

      // Committed: only now is the superseded file safe to remove.
      if (replacedFileName && replacedFileName !== fileName) {
        try {
          await fs.promises.unlink(resolveInsideDir(uploadsDir, replacedFileName));
        } catch (err) {
          console.warn('Could not delete superseded solution file:', err);
        }
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'UPDATE_PROBLEM',
        severity: 'INFO',
        category: 'PROBLEM',
        courseId,
        problemId,
        metadata: {
          userId: user.id,
          courseId,
          problemId,
          problemTitle: updatedProblem.title,
          problemType: type,
          fileName,
          fileUpdated: !!file,
        },
      });

      return NextResponse.json(updatedProblem);
    } catch (err) {
      console.error('Problem update error:', err);
      await logError(req, {
        userId: user.id,
        action: 'PROBLEM_UPDATE_ERROR',
        category: 'PROBLEM',
        courseId,
        problemId,
        error: err,
      });
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_UPDATE_DENIED', blockWhenArchived: true },
);

/** Thrown inside the deletion transaction so the whole thing rolls back rather than half-applying. */
class ProblemInUseError extends Error {}

/**
 * Deletes a problem within a course and its solution file. Course staff (faculty or
 * TAs) or a system admin. The problem must belong to the course in the path. Refused
 * while the problem is still attached to any assignment (problems are shared across
 * assignments many-to-many); otherwise its submissions are removed first, then the
 * record and file.
 * @openapi
 * summary: Delete a course problem
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 *   - { name: pid, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Problem deleted. }
 *   400: { description: Problem is still linked to an assignment. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: Problem not found in this course. }
 *   500: { description: Server error. }
 */
export const DELETE = withCourseAuth(
  async (req, ctx, { user, courseId }) => {
    const { pid: problemId } = await ctx.params;
    try {
      // The problem must belong to the course in the path.
      const existingProblem = await prisma.problem.findFirst({
        where: { id: problemId, courseId },
      });
      if (!existingProblem) {
        return NextResponse.json({ error: 'Problem not found' }, { status: 404 });
      }

      /**
       * The link check and the delete, in one transaction, holding the problem's own row.
       *
       * Deletion is refused while the problem is attached to any assignment, because
       * `AssignmentProblem.problem` cascades and problems are shared across assignments. The
       * check and the delete were separate statements, so the link could appear in between:
       * the delete would then take the new link with it, and the submissions and grades hanging
       * off that link would cascade too.
       *
       * Creating an `AssignmentProblem` takes `FOR KEY SHARE` on this problem's row, which
       * `FOR UPDATE` conflicts with, so only the two consistent orders remain. Either the lock
       * is ours and the attach waits, then fails its foreign key against a problem that is
       * gone, or the attach holds the row and we see the link and refuse.
       */
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "Problem" WHERE "id" = ${problemId} FOR UPDATE`;

          const linked = await tx.assignmentProblem.findFirst({ where: { problemId } });
          if (linked) throw new ProblemInUseError();

          // With no link there can be no submission: a submission's foreign key is the link,
          // not the problem. Kept as a belt-and-braces sweep, now inside the guard that makes
          // it provably a no-op rather than outside it where a race gave it something to hit.
          await tx.submission.deleteMany({ where: { problemId } });
          await tx.problem.delete({ where: { id: problemId } });
        });
      } catch (err) {
        if (err instanceof ProblemInUseError) {
          return NextResponse.json(
            { error: 'Problem is associated with an assignment and cannot be deleted' },
            { status: 400 },
          );
        }
        throw err;
      }

      /**
       * The file goes last, after the row is certainly gone.
       *
       * It used to be unlinked first, so a delete that failed for any reason, the race above
       * included, left the problem in place with its answer key missing. The same ordering the
       * update path already uses: the database is the thing that must not be wrong, and an
       * orphaned file is a tidiness problem rather than a broken problem.
       */
      if (existingProblem.fileName) {
        try {
          await fs.promises.unlink(resolveInsideDir(uploadsDir, existingProblem.fileName));
        } catch (err) {
          console.warn('Could not delete problem file:', err);
        }
      }

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'DELETE_PROBLEM',
        severity: 'INFO',
        category: 'PROBLEM',
        courseId,
        problemId,
        metadata: {
          userId: user.id,
          courseId,
          problemId,
          problemTitle: existingProblem.title,
          fileName: existingProblem.fileName || null,
        },
      });

      return NextResponse.json({ success: true });
    } catch (err) {
      console.error('Problem deletion error:', err);
      await logError(req, {
        userId: user.id,
        action: 'PROBLEM_DELETE_ERROR',
        category: 'PROBLEM',
        courseId,
        problemId,
        error: err,
      });
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_DELETE_DENIED', blockWhenArchived: true },
);
