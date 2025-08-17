// /src/app/api/courses/[id]/problems/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { auth } from '@/lib/auth';
import { ProblemType } from '@prisma/client';

// Create solution upload directory if it doesn't exist
async function ensureDirExists(dir: string) {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory already exists or was just created
  }
}

// Upload directory path
const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'solutions');

// POST: Create a new problem with optional solution file
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params;

  try {
    // Step 1: Authorize only TA, FACULTY, or ADMIN
    const session = await auth();
    const user = session?.user;

    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
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
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'CREATE_PROBLEM',
        metadata: {
          courseId,
          problemId: problem.id,
          fileName,
          originalFileName,
          type,
          ipAddress: ip,
          userAgent,
        },
      },
    });

    return NextResponse.json(problem, { status: 201 });
  } catch (error) {
    console.error('Error creating problem:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET: List all problems for a specific course
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params;

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
