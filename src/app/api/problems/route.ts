// /src/app/api/problems/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { auth } from '@/lib/auth';
import { ProblemType } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';

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
    const maxSubmissions = formData.get('maxSubmissions') as string | null;
    const maxPoints = formData.get('maxPoints') as string;
    const courseId = formData.get('courseId') as string;
    const assignmentId = formData.get('assignmentId') as string;
    const maxStates = formData.get('maxStates') as string | null;
    const isDeterministic = formData.get('isDeterministic') === 'true';
    const autograderEnabled = formData.get('autograderEnabled');
    const autograderBool = autograderEnabled === 'false' ? false : true;
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

    const xml = await file.text();
    const validation = validateStructureXML(xml, type);

    // Error check
    if (!validation.isValid) {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SUBMISSION_INVALID_FILE_STRUCTURE',
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

    // Ensure upload directory exists
    const uploadsDir = path.join('/private', 'uploads', 'solutions');
    fs.mkdirSync(uploadsDir, { recursive: true });

    // Write uploaded file to disk
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
