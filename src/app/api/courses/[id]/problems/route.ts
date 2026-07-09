import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { ProblemType } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';
import { withCourseAuth } from '@/lib/api/with-auth';

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
 *           maxPoints: { type: string }
 *           maxSubmissions: { type: string }
 *           maxStates: { type: string, description: FA/PDA only }
 *           isDeterministic: { type: string, enum: ['true', 'false'], description: FA only }
 *           autograderEnabled: { type: string, enum: ['true', 'false'] }
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
      // Parse multipart form data
      const formData = await req.formData();

      const title = formData.get('title') as string;
      const description = formData.get('description') as string;
      const type = formData.get('type') as string;
      const maxSubmissions = formData.get('maxSubmissions') as string | null;
      const maxPoints = formData.get('maxPoints') as string;
      const assignmentId = formData.get('assignmentId') as string;
      const maxStates = formData.get('maxStates') as string | null;
      const isDeterministic = formData.get('isDeterministic') === 'true';
      const autograderEnabled = formData.get('autograderEnabled');
      const autograderBool = autograderEnabled === 'false' ? false : true;
      const file = formData.get('file') as File | null;

      // Validate required fields
      if (!title || !file || !type) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
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
          action: 'SUBMISSION_INVALID_FILE_STRUCTURE',
          severity: 'WARNING',
          category: 'SUBMISSION',
          courseId,
          assignmentId,
          metadata: {
            userId: user.id,
            courseId,
            assignmentId,
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

      // Write uploaded file to disk
      fs.mkdirSync(uploadsDir, { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileName = `${Date.now()}-${file.name}`;
      const fullPath = path.join(uploadsDir, fileName);
      fs.writeFileSync(fullPath, buffer, { mode: 0o755 });

      // Create the problem record in the database
      const problem = await prisma.problem.create({
        data: {
          title,
          description,
          type: type as ProblemType,
          maxSubmissions: parseInt(maxSubmissions || '0', 10),
          maxPoints: parseInt(maxPoints || '0', 10),
          courseId,
          fileName,
          originalFileName: file.name,
          autograderEnabled: autograderBool,
          maxStates: ['FA', 'PDA'].includes(type) ? parseInt(maxStates || '0', 10) || null : null,
          isDeterministic: type === 'FA' ? isDeterministic : null,
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
          maxPoints: problem.maxPoints,
          autograderEnabled: problem.autograderEnabled,
          fileName,
        },
      });

      return NextResponse.json(problem, { status: 201 });
    } catch (error) {
      console.error('Error creating problem:', error);
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'PROBLEM_CREATE_ERROR',
        severity: 'ERROR',
        metadata: { error: error instanceof Error ? error.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_CREATE_DENIED' },
);
