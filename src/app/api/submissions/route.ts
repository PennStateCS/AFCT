// /src/app/api/submissions/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';

export async function POST(req: NextRequest) {
  // 1. Verify session
  const session = await auth();
  if (!session) {
    console.warn('Unauthorized submission attempt');
    await createEnhancedActivityLog(prisma, req, {
      userId: undefined,
      action: 'SUBMISSION_UNAUTHORIZED',
      category: 'SUBMISSION',
      metadata: { userId: undefined },
    });

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse multipart form data
  const formData = await req.formData();
  const courseId = formData.get('courseId')?.toString();
  const assignmentId = formData.get('assignmentId')?.toString();
  const problemId = formData.get('problemId')?.toString();
  const file = formData.get('file') as File | null;
  const { maxBytes, maxMb } = await getSystemUploadLimit();

  if (!assignmentId || !problemId) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'SUBMISSION_INVALID_REQUEST',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: session.user.id,
        courseId,
        assignmentId,
        problemId,
        error: 'Missing required fields',
      },
    });
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // 3. Ensure the problem is linked to the assignment and get problem details
  const link = await prisma.assignmentProblem.findUnique({
    where: {
      assignmentId_problemId: {
        assignmentId,
        problemId,
      },
    },
    include: {
      problem: {
        select: {
          fileName: true,
          maxPoints: true,
          maxStates: true,
          autograderEnabled: true,
          isDeterministic: true,
          type: true,
        },
      },
    },
  });

  if (!link) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'SUBMISSION_INVALID_REQUEST',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: session.user.id,
        courseId,
        assignmentId,
        problemId,
        error: 'Problem is not linked to this assignment.',
      },
    });
    return NextResponse.json(
      { error: 'Problem is not linked to this assignment.' },
      { status: 400 },
    );
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      dueDate: true,
      allowLateSubmissions: true,
      lateCutoff: true,
    },
  });

  if (!assignment) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'SUBMISSION_INVALID_REQUEST',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: session.user.id,
        courseId,
        assignmentId,
        problemId,
        error: 'Assignment not found.',
      },
    });
    return NextResponse.json({ error: 'Assignment not found.' }, { status: 404 });
  }

  const now = new Date();
  const isLate = now > assignment.dueDate;

  if (isLate) {
    if (!assignment.allowLateSubmissions) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'SUBMISSION_REJECTED_LATE',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: session.user.id,
          courseId,
          assignmentId,
          problemId,
          dueDate: assignment.dueDate.toISOString(),
          allowLateSubmissions: assignment.allowLateSubmissions,
          lateCutoff: assignment.lateCutoff ? assignment.lateCutoff.toISOString() : null,
          submittedAt: now.toISOString(),
          reason: 'Late submissions are not allowed for this assignment.',
        },
      });
      return NextResponse.json(
        { error: 'Late submissions are not allowed for this assignment.' },
        { status: 403 },
      );
    }

    if (assignment.lateCutoff && now > assignment.lateCutoff) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'SUBMISSION_REJECTED_LATE_CUTOFF',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: session.user.id,
          courseId,
          assignmentId,
          problemId,
          dueDate: assignment.dueDate.toISOString(),
          allowLateSubmissions: assignment.allowLateSubmissions,
          lateCutoff: assignment.lateCutoff.toISOString(),
          submittedAt: now.toISOString(),
          reason: 'Late submission cutoff has passed for this assignment.',
        },
      });
      return NextResponse.json(
        { error: 'Late submission cutoff has passed for this assignment.' },
        { status: 403 },
      );
    }
  }

  let fileName: string | null = null;
  let originalFileName: string | null = null;
  let feedback: string | null = null;
  let correct: boolean | undefined = undefined;
  let evaluationRaw: unknown | null = null;
  let uploadedFilePath: string | null = null;

  if (file) {
    const xml = await file.text();
    const validation = validateStructureXML(xml, link.problem.type);

    // Error check
    if (!validation.isValid) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'SUBMISSION_INVALID_FILE_STRUCTURE',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: session.user.id,
          courseId,
          assignmentId,
          problemId,
          error: validation.error,
        },
      });

      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
  }

  try {
    // 4. Handle file upload
    if (file) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'SUBMISSION_FILE_RECEIVED',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: session.user.id,
          courseId,
          assignmentId,
          problemId,
          fileName: file.name,
          fileSizeBytes: file.size,
          fileType: file.type,
        },
      });
      if (file.size > maxBytes) {
        return NextResponse.json(
          { error: `File exceeds max upload size (${maxMb} MB).` },
          { status: 413 },
        );
      }
      originalFileName = file.name;
      const fileExt = path.extname(originalFileName);
      fileName = `${randomUUID()}${fileExt}`;

      const uploadDir = path.join('/private', 'uploads', 'submissions');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer, { mode: 0o755 });
      uploadedFilePath = filePath;
    }

    // 5. Store the submission
    let submission = await prisma.submission.create({
      data: {
        courseId,
        assignmentId,
        problemId,
        studentId: session.user.id,
        fileName,
        originalFileName,
        feedback,
        correct,
        evaluationRaw:
          evaluationRaw === null ? Prisma.JsonNull : (evaluationRaw as Prisma.InputJsonValue),
      },
    });

    if (fileName) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'SUBMISSION_FILE_STORED',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        submissionId: submission.id,
        metadata: {
          userId: session.user.id,
          courseId,
          assignmentId,
          problemId,
          submissionId: submission.id,
          fileName,
          originalFileName,
        },
      });
    }

    // 6. Log successful submission
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'SUBMISSION_CREATED',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      submissionId: submission.id,
      metadata: {
        userId: session.user.id,
        courseId: courseId,
        assignmentId: assignmentId,
        problemId: problemId,
        submissionId: submission.id,
        fileName: fileName,
        status: "PENDING",
      },
    });

    // Success
    return NextResponse.json(submission, { status: 202 });

    // Error
  } catch (error: unknown) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'SUBMISSION_ERROR',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: session.user.id,
        courseId: courseId,
        assignmentId: assignmentId,
        problemId: problemId,
        error: error instanceof Error ? error.message : String(error),
        status: "FAILED",
      },
    });

    return NextResponse.json({ error: 'Failed to create submission' }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ sid: string }> }) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (session.user.role != 'ADMIN' && session.user.role != 'FACULTY') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sid } = await params;

  const submission = await prisma.submission.findUnique({
    where: {
      id: sid,
    },
    select: {
      id: true,
      studentId: true,
      courseId: true,
      assignmentId: true,
      problemId: true,
      student: {
        select: {
          firstName: true,
          lastName: true,
        }
      },
      course: {
        select: { name: true },
      },
      assignmentProblem: {
        select: {
          assignment: {
            select: { title: true },
          }
        }
      },
      submittedAt: true,
      status: true,
      fileName: true,
      originalFileName: true,
    }
  });

  // No submission found
  if (!submission) {
    return null;
  }

  const transformedSubmission = {
    id: submission.id,
    studentId: submission.studentId,
    courseId: submission.courseId,
    assignmentId: submission.assignmentId,
    problemId: submission.problemId,
    studentName: `${submission.student.firstName} ${submission.student.lastName}`,
    courseName: submission.course.name,
    assignmentTitle: submission.assignmentProblem.assignment.title,
    submittedAt: submission.submittedAt,
    status: submission.status,
    fileName: submission.fileName,
    originalFileName: submission.originalFileName,   
  };

  return NextResponse.json(transformedSubmission);
}
