// /src/app/api/problems/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { auth } from '@/lib/auth';
import { ProblemType } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';

// POST /api/problems - Create a new problem with file upload
export async function POST(req: Request) {
  try {
    // Verify authenticated user
    const session = await auth();
    const user = session?.user;

    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Parse multipart form data
    const formData = await req.formData();

    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    const type = formData.get('type') as string;
    const courseId = formData.get('courseId') as string;
    const maxStates = formData.get('maxStates') as string | null;
    const isDeterministic = formData.get('isDeterministic') === 'true';
    const file = formData.get('file') as File | null;

    // Validate required fields
    if (!title || !file || !courseId || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { maxBytes, maxMb } = await getSystemUploadLimit();
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `File exceeds max upload size (${maxMb} MB).` },
        { status: 413 },
      );
    }

    // Ensure upload directory exists
    const uploadsDir = path.join(process.cwd(), 'private', 'uploads', 'problems');
    fs.mkdirSync(uploadsDir, { recursive: true });

    // Write uploaded file to disk
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `${Date.now()}-${file.name}`;
    const fullPath = path.join(uploadsDir, fileName);
    try {
      fs.writeFileSync(fullPath, buffer, {mode: 0o755});
    } catch (writeErr) {
      console.error('Failed to write problem file:', writeErr);
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'PROBLEM_FILE_WRITE_FAILED',
        category: 'PROBLEM',
        courseId,
        metadata: { fileName, filePath: fullPath, error: writeErr instanceof Error ? writeErr.message : String(writeErr) },
      });
      return NextResponse.json({ error: 'Failed to save uploaded problem file' }, { status: 500 });
    }

    // Create the problem record in the database
    const problem = await prisma.problem.create({
      data: {
        title,
        description,
        type: type as ProblemType,
        courseId,
        fileName,
        originalFileName: file.name,
        maxStates: ['FA', 'PDA'].includes(type) ? parseInt(maxStates || '0', 10) || null : null,
        isDeterministic: type === 'FA' ? isDeterministic : null,
      },
    });

    // Log creation activity
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'CREATE_PROBLEM',
      category: 'PROBLEM',
      courseId,
      problemId: problem.id,
      metadata: {
        userId: user.id,
        courseId: courseId,
        problemId: problem.id,
        problemType: type,
        fileName,
      },
    });

    return NextResponse.json(problem);
  } catch (err) {
    console.error('Problem creation error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
