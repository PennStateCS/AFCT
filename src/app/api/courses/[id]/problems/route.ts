import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { withCourseAuth } from '@/lib/api/with-auth';

type ProblemType = 'PDA' | 'RE' | 'CFG' | 'FA';

// Create solution upload directory if it doesn't exist
async function ensureDirExists(dir: string) {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory already exists or was just created
  }
}

// Upload directory path
const uploadDir = path.join('/private', 'uploads', 'solutions');

/**
 * Creates a problem in a course from an uploaded solution file. Course staff
 * (faculty or TAs) or a system admin. The file is size-checked and stored under a generated name;
 * `maxStates` applies to FA/PDA and `isDeterministic` to FA. (Sibling of
 * POST /api/problems, scoped to the course in the path.)
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
 *           type: { type: string, enum: [PDA, RE, CFG, FA] }
 *           maxStates: { type: string, description: FA/PDA only }
 *           isDeterministic: { type: string, enum: ['true', 'false'], description: FA only }
 *           file: { type: string, format: binary }
 * responses:
 *   201: { description: The created problem. }
 *   400: { description: Missing fields or file. }
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
      const description = formData.get('description') as string | null;
      const type = formData.get('type') as string;
      const maxStates = formData.get('maxStates')
        ? parseInt(formData.get('maxStates') as string, 10)
        : null;
      const isDeterministic = formData.get('isDeterministic') === 'true';
      const file = formData.get('file') as File | null;

      if (!title || !type) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      }

      if (!file || typeof file === 'string') {
        return NextResponse.json({ error: 'Missing or invalid file' }, { status: 400 });
      }

      const { maxBytes, maxMb } = await getSystemUploadLimit();
      if (file.size > maxBytes) {
        return NextResponse.json(
          { error: `File exceeds max upload size (${maxMb} MB).` },
          { status: 413 },
        );
      }

      // Ensure course exists
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }

      // Save the uploaded file to disk
      await ensureDirExists(uploadDir);
      const originalFileName = file.name;
      const ext = path.extname(originalFileName);
      const fileName = `${uuidv4()}${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(uploadDir, fileName), buffer);

      // Create the new problem in the database
      const problem = await prisma.problem.create({
        data: {
          title,
          description,
          type: type as ProblemType,
          fileName,
          originalFileName,
          courseId,
          maxStates: type === 'FA' || type === 'PDA' ? maxStates : null,
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
          courseId: courseId,
          probleId: problem.id,
          problemTitle: problem.title,
          fileName: fileName,
          originalFileName: originalFileName,
          type: type,
        },
      });

      return NextResponse.json(problem, { status: 201 });
    } catch (error) {
      console.error('Error creating problem:', error);
      await createEnhancedActivityLog(prisma, req, {
        userId: null,
        action: 'PROBLEM_CREATE_ERROR',
        severity: 'ERROR',
        metadata: { error: error instanceof Error ? error.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  },
  { access: 'manage', deniedAction: 'PROBLEM_CREATE_DENIED' },
);
