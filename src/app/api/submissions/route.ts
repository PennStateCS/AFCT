import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/app/utils/jwt';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.split(' ')[1];
  const decoded = token ? verifyToken(token) : null;

  if (!decoded) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const assignmentId = formData.get('assignmentId')?.toString();
  const problemId = formData.get('problemId')?.toString();
  const content = formData.get('content')?.toString() || '';
  const file = formData.get('file') as File | null;

  if (!assignmentId || !problemId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Ensure this problem is actually part of the assignment
  const link = await prisma.assignmentProblem.findUnique({
    where: {
      assignmentId_problemId: {
        assignmentId,
        problemId,
      },
    },
  });

  if (!link) {
    return NextResponse.json(
      { error: 'Problem is not linked to this assignment.' },
      { status: 400 },
    );
  }

  let fileName: string | null = null;
  let originalFileName: string | null = null;

  try {
    if (file) {
      originalFileName = file.name;
      const fileExt = path.extname(originalFileName);
      fileName = `${randomUUID()}${fileExt}`;

      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'submissions');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
    }

    const submission = await prisma.submission.create({
      data: {
        assignmentId,
        problemId,
        content,
        studentId: decoded.userId,
        fileName,
        originalFileName,
      },
    });

    return NextResponse.json(submission, { status: 201 });
  } catch (error) {
    console.error('Submission error:', error);
    return NextResponse.json({ error: 'Failed to create submission' }, { status: 500 });
  }
}
