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
import { readFormData } from '@/lib/api/request';
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
 *           maxPoints: { type: string }
 *           maxSubmissions: { type: string }
 *           maxStates: { type: string }
 *           isDeterministic: { type: string, enum: ['true', 'false'] }
 *           autograderEnabled: { type: string, enum: ['true', 'false'] }
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
        const xml = await file.text();
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

        fs.mkdirSync(uploadsDir, { recursive: true });

        // Delete old file if it exists (resolve it inside the uploads dir so a
        // legacy/unsafe stored name can't be used to unlink outside it).
        if (existingProblem.fileName) {
          try {
            fs.unlinkSync(resolveInsideDir(uploadsDir, existingProblem.fileName));
          } catch (err) {
            console.warn('Could not delete old file:', err);
          }
        }

        // Store under a random UUID + sanitized extension, never a path derived
        // from client input; keep the original name only as display metadata.
        const buffer = Buffer.from(await file.arrayBuffer());
        fileName = safeStoredFilename(file.name);
        originalFileName = file.name;
        fs.writeFileSync(resolveInsideDir(uploadsDir, fileName), buffer, { mode: 0o644 });
      }

      const updatedProblem = await prisma.problem.update({
        where: { id: problemId },
        data: {
          title,
          description: data.description ?? null,
          type: type as ProblemType,
          fileName,
          originalFileName,
          maxSubmissions: data.maxSubmissions ?? null,
          maxPoints: data.maxPoints ?? undefined,
          maxStates: ['FA', 'PDA'].includes(type) ? (data.maxStates ?? 0) || null : null,
          isDeterministic: type === 'FA' ? (data.isDeterministic ?? false) : null,
          autograderEnabled: data.autograderEnabled ?? false,
        },
      });

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
          maxPoints: updatedProblem.maxPoints,
          autograderEnabled: updatedProblem.autograderEnabled,
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
        courseId,
        problemId,
        error: err,
      });
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_UPDATE_DENIED', blockWhenArchived: true },
);

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

      // Refuse deletion while the problem is linked to any assignment. Problems are
      // shared across assignments (many-to-many), so a silent cascade-unlink would
      // remove it from other assignments too.
      const linked = await prisma.assignmentProblem.findFirst({ where: { problemId } });
      if (linked) {
        return NextResponse.json(
          { error: 'Problem is associated with an assignment and cannot be deleted' },
          { status: 400 },
        );
      }

      await prisma.submission.deleteMany({ where: { problemId } });

      if (existingProblem.fileName) {
        try {
          fs.unlinkSync(resolveInsideDir(uploadsDir, existingProblem.fileName));
        } catch (err) {
          console.warn('Could not delete problem file:', err);
        }
      }

      await prisma.problem.delete({ where: { id: problemId } });

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
        courseId,
        problemId,
        error: err,
      });
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_DELETE_DENIED', blockWhenArchived: true },
);
