import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

async function ensureDirExists(dir: string) {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Ignore if exists
  }
}

const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'solutions');

// POST: Create a problem with file upload
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params; // ✅ Await params

  try {
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

    // Ensure the course exists
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    await ensureDirExists(uploadDir);

    const originalFileName = file.name;
    const ext = path.extname(originalFileName);
    const fileName = `${uuidv4()}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, fileName), buffer);

    // Insert the problem
    const problem = await prisma.problem.create({
      data: {
        title,
        description,
        type: type as any, // cast to ProblemType enum
        fileName,
        originalFileName,
        courseId,
        maxStates: type === 'FA' || type === 'PDA' ? maxStates : null,
        isDeterministic: type === 'FA' ? isDeterministic : null,
      },
    });

    return NextResponse.json(problem, { status: 201 });
  } catch (error) {
    console.error('Error creating problem:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET: Fetch problems for a course
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params; // ✅ Await params

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
