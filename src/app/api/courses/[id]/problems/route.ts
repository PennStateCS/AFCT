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
  ProblemCreateApiSchema,
  ALLOWED_PROBLEM_EXTENSIONS,
  isAllowedProblemExtension,
} from '@/schemas/problem';

// Solution files are written here; the URL to serve them is /api/files/solutions/[file].
const uploadsDir = path.join('/private', 'uploads', 'solutions');

/**
 * Creates a problem in a course from an uploaded solution file (multipart/form-data).
 * Course staff (faculty or TAs) or a system admin. The file's XML structure is
 * validated against the problem type before it's written to disk, and it's
 * size-checked against the system upload limit. `maxStates` applies to FA/PDA and
 * `isDeterministic` to FA. The course comes from the path.
 * @openapi
 * summary: Create a problem in a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         required: [title, type, file]
 *         properties:
 *           title: { type: string }
 *           description: { type: string }
 *           type: { type: string, description: "Problem type (e.g. FA, PDA, RE, CFG)" }
 *           assignmentId: { type: string }
 *           maxStates: { type: string, description: FA/PDA only }
 *           isDeterministic: { type: string, enum: ['true', 'false'], description: FA only }
 *           file: { type: string, format: binary, description: Solution definition (XML) }
 * responses:
 *   201: { description: The created problem. }
 *   400: { description: Missing fields or the solution file failed structure validation. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not course staff (faculty or TA) or a system admin. }
 *   404: { description: Course not found. }
 *   413: { description: File exceeds the system upload limit. }
 *   500: { description: Server error. }
 */
export const POST = withCourseAuth(
  async (req, _ctx, { user, courseId }) => {
    try {
      // Validate the scalar fields server-side (title, type, coerced numbers/bools).
      const parsed = await readFormData(req, ProblemCreateApiSchema);
      if (!parsed.ok) return parsed.response;
      const data = parsed.data;
      const { title, type } = data;
      const file = parsed.form.get('file') as File | null;

      if (!file) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      // Enforce the solution-file extension allow-list server-side (previously only
      // the browser checked this).
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
          metadata: {
            userId: user.id,
            courseId,
            error: validation.error,
          },
        });

        return NextResponse.json({ error: validation.error }, { status: 400 });
      }

      // Ensure the course exists before writing anything.
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }

      // Write uploaded file to disk under a random UUID + sanitized extension:
      // never a path derived from the client-supplied file.name. Written
      // non-executable; the original name is kept only as display metadata below.
      fs.mkdirSync(uploadsDir, { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileName = safeStoredFilename(file.name);
      const fullPath = resolveInsideDir(uploadsDir, fileName);
      fs.writeFileSync(fullPath, buffer, { mode: 0o644 });

      // Create the problem record in the database
      const problem = await prisma.problem.create({
        data: {
          title,
          description: data.description ?? null,
          type: type as ProblemType,
          courseId,
          fileName,
          originalFileName: file.name,
          maxStates: ['FA', 'PDA'].includes(type) ? (data.maxStates ?? 0) || null : null,
          isDeterministic: type === 'FA' ? (data.isDeterministic ?? false) : null,
        },
      });

      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'CREATE_PROBLEM',
        severity: 'INFO',
        category: 'PROBLEM',
        courseId,
        problemId: problem.id,
        metadata: {
          userId: user.id,
          courseId,
          problemId: problem.id,
          problemTitle: problem.title,
          problemType: type,
          fileName,
        },
      });

      return NextResponse.json(problem, { status: 201 });
    } catch (error) {
      console.error('Error creating problem:', error);
      await logError(req, {
        userId: user.id,
        action: 'PROBLEM_CREATE_ERROR',
        category: 'PROBLEM',
        courseId,
        error,
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_CREATE_DENIED', blockWhenArchived: true },
);
