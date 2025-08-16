// /src/app/api/submissions/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/app/utils/jwt';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import os from 'os';

// Helper to extract IP address from headers or fallback
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  // Note: req.ip is not available in Next.js App Router, fallback to 'unknown'
  return 'unknown';
}

// Helper to extract user-agent
function getUserAgent(req: NextRequest): string {
  return req.headers.get('user-agent') || 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  // 1. Verify token
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.split(' ')[1];
  const decoded = token ? verifyToken(token) : null;

  if (!decoded) {
    console.warn('Unauthorized submission attempt');
    await prisma.activityLog.create({
      data: {
        userId: null,
        action: 'SUBMISSION_UNAUTHORIZED',
        metadata: { ipAddress: ip, userAgent },
      },
    });

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse multipart form data
  const formData = await req.formData();
  const assignmentId = formData.get('assignmentId')?.toString();
  const problemId = formData.get('problemId')?.toString();
  const file = formData.get('file') as File | null;

  if (!assignmentId || !problemId) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // 3. Ensure the problem is linked to the assignment
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
  let feedback: string | null = null;

  try {
    // 4. Handle file upload
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

      // 4b. Run system command to analyze the uploaded file
      try {
        if (os.platform() === 'win32') {
          const result = execSync(`powershell -Command "(Get-Content '${filePath}').Count"`, {
            encoding: 'utf-8',
          });
          feedback = `File has ${result.trim()} lines (Windows).`;
        } else {
          const result = execSync(`wc -l < "${filePath}"`, { encoding: 'utf-8' });
          feedback = `File has ${result.trim()} lines (Unix).`;
        }
      } catch (cmdErr) {
        console.error('Command execution failed:', cmdErr);
        feedback = 'ERROR: Failed to analyze file.';
      }
    }

    // 5. Store the submission
    const submission = await prisma.submission.create({
      data: {
        assignmentId,
        problemId,
        studentId: decoded.userId,
        fileName,
        originalFileName,
        feedback,
      },
    });

    // 6. Log successful submission
    await prisma.activityLog.create({
      data: {
        userId: decoded.userId,
        action: 'SUBMISSION_CREATED',
        metadata: {
          assignmentId,
          problemId,
          fileName,
          ipAddress: ip,
          userAgent,
        },
      },
    });

    return NextResponse.json(submission, { status: 201 });
  } catch (error) {
    console.error('Submission error:', error);

    await prisma.activityLog.create({
      data: {
        userId: decoded.userId,
        action: 'SUBMISSION_ERROR',
        metadata: {
          assignmentId,
          problemId,
          error: error instanceof Error ? error.message : 'Unknown error',
          ipAddress: ip,
          userAgent,
        },
      },
    });

    return NextResponse.json({ error: 'Failed to create submission' }, { status: 500 });
  }
}
