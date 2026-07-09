import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { ProblemType } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';
import { withCourseAuth } from '@/lib/api/with-auth';

// Solution files live here; the URL to serve them is /api/files/solutions/[file].
const uploadsDir = path.join('/private', 'uploads', 'solutions');

/**
 * Updates a problem within a course (multipart/form-data). Course staff (faculty or
 * TAs) or a system admin. The problem must belong to the course in the path. Sending a
 * new file replaces the stored solution — it's structure-validated and size-checked
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

      const formData = await req.formData();
      const title = formData.get('title') as string;
      const description = formData.get('description') as string;
      const type = formData.get('type') as string;
      const maxSubmissions = formData.get('maxSubmissions') as string | null;
      const maxPoints = formData.get('maxPoints') as string | null;
      const assignmentId = formData.get('assignmentId') as string;
      const maxStates = formData.get('maxStates') as string | null;
      const isDeterministic = formData.get('isDeterministic') === 'true';
      const autograderEnabled = formData.get('autograderEnabled') === 'true';
      const file = formData.get('file') as File | null;

      if (!title || !type) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      let fileName = existingProblem.fileName;
      let originalFileName = existingProblem.originalFileName;

      // Handle file update if a new file is provided
      if (file && file.size > 0) {
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
            action: 'SUBMISSION_INVALID_FILE_STRUCTURE',
            severity: 'WARNING',
            category: 'SUBMISSION',
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

        // Delete old file if it exists
        if (existingProblem.fileName) {
          const oldFilePath = path.join(uploadsDir, existingProblem.fileName);
          try {
            fs.unlinkSync(oldFilePath);
          } catch (err) {
            console.warn('Could not delete old file:', err);
          }
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        fileName = `${Date.now()}-${file.name}`;
        originalFileName = file.name;
        fs.writeFileSync(path.join(uploadsDir, fileName), buffer);
      }

      const updatedProblem = await prisma.problem.update({
        where: { id: problemId },
        data: {
          title,
          description,
          type: type as ProblemType,
          fileName,
          originalFileName,
          maxSubmissions: maxSubmissions ? parseInt(maxSubmissions, 10) : null,
          maxPoints: maxPoints ? parseInt(maxPoints, 10) : undefined,
          maxStates: ['FA', 'PDA'].includes(type) ? parseInt(maxStates || '0', 10) || null : null,
          isDeterministic: type === 'FA' ? isDeterministic : null,
          autograderEnabled,
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
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'PROBLEM_UPDATE_ERROR',
        severity: 'ERROR',
        metadata: { error: err instanceof Error ? err.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_UPDATE_DENIED' },
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
        const filePath = path.join(uploadsDir, existingProblem.fileName);
        try {
          fs.unlinkSync(filePath);
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
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'PROBLEM_DELETE_ERROR',
        severity: 'ERROR',
        metadata: { error: err instanceof Error ? err.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_DELETE_DENIED' },
);
