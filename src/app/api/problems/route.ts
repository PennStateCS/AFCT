// /src/app/api/problems/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { ProblemType } from '@prisma/client';

// POST /api/problems - Create a new problem with file upload
export async function POST(req: Request) {
  try {
    // Verify authenticated user
    const session = await getServerSession(authOptions);
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

    // Ensure upload directory exists
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'problems');
    fs.mkdirSync(uploadsDir, { recursive: true });

    // Write uploaded file to disk
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `${Date.now()}-${file.name}`;
    const fullPath = path.join(uploadsDir, fileName);
    fs.writeFileSync(fullPath, buffer);

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
          problemType: type,
          fileName,
          ipAddress: ip,
          userAgent,
        },
      },
    });

    return NextResponse.json(problem);
  } catch (err) {
    console.error('Problem creation error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
