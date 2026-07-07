import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';

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
 * Creates a problem in a course from an uploaded solution file. Staff only
 * (ADMIN/FACULTY/TA). The file is size-checked and stored under a generated name;
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
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Course not found. }
 *   413: { description: File exceeds the system upload limit. }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params;

  try {
    const session = await auth();
    const user = session?.user;

    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'PROBLEM_CREATE_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Step 2: Parse multipart form data
    const formData = await req.formData();
    const title = formData.get('title') as string;
    const description = formData.get('description') as string | null;
    const type = formData.get('type') as string;
    const maxStates = formData.get('maxStates')
      ? parseInt(formData.get('maxStates') as string, 10)
      : null;
    const isDeterministic = formData.get('isDeterministic') === 'true';
    const file = formData.get('file') as File | null;

    if (!title || !type || !courseId) {
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

    // Step 3: Ensure course exists
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Step 4: Save the uploaded file to disk
    await ensureDirExists(uploadDir);
    const originalFileName = file.name;
    const ext = path.extname(originalFileName);
    const fileName = `${uuidv4()}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, fileName), buffer);

    // Step 5: Create the new problem in the database
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

    // Step 6: Log the problem creation
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
}

/**
 * Lists all problems in a course, newest first. Staff only (ADMIN/FACULTY/TA) — the
 * rows include stored solution filenames, which students must not see. The solution
 * files themselves are served by a separate, access-controlled route.
 * @openapi
 * summary: List a course's problems
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200:
 *     description: The course's problems.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   403: { description: Caller lacks a staff role. }
 *   500: { description: Server error. }
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params;

  const session = await auth();
  const role = session?.user?.role;
  if (!role || !['ADMIN', 'FACULTY', 'TA'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const problems = await prisma.problem.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(problems);
  } catch (error) {
    console.error('Error fetching problems:', error);
    return NextResponse.json({ error: 'Failed to fetch problems' }, { status: 500 });
  }
}
