import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { getQueueSettings } from '@/lib/eval-config';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';

/**
 * Submits a student's solution file for one assignment problem (multipart/form-data)
 * and queues it for evaluation. Requires a signed-in user who is enrolled in the
 * course (admins may submit anywhere). The problem must be linked to the assignment;
 * the authoritative course comes from the assignment, not the client. Enforces a
 * resubmit cooldown (429), the assignment's late/late-cutoff policy (403), an upload
 * size limit (413), and XML structure validation. On success the submission is
 * stored PENDING and returned with 202.
 * @openapi
 * summary: Submit a solution
 * requestBody:
 *   required: true
 *   content:
 *     multipart/form-data:
 *       schema:
 *         type: object
 *         required: [assignmentId, problemId]
 *         properties:
 *           assignmentId: { type: string }
 *           problemId: { type: string }
 *           courseId: { type: string, description: Ignored; derived from the assignment }
 *           file: { type: string, format: binary, description: The solution file (XML) }
 * responses:
 *   202: { description: Submission accepted and queued (status PENDING). }
 *   400: { description: Missing fields, unlinked problem, or invalid file structure. }
 *   401: { description: Not signed in. }
 *   403: { description: Not enrolled, or the late/late-cutoff policy rejected it. }
 *   404: { description: Assignment not found. }
 *   413: { description: File exceeds the system upload limit. }
 *   429: { description: Resubmit cooldown in effect (see Retry-After). }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    console.warn('Unauthorized submission attempt');
    await createEnhancedActivityLog(prisma, req, {
      userId: undefined,
      action: 'SUBMISSION_UNAUTHORIZED',
      severity: 'SECURITY',
      category: 'SUBMISSION',
      metadata: { userId: undefined },
    });

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse multipart form data
  const formData = await req.formData();
  let courseId = formData.get('courseId')?.toString();
  const assignmentId = formData.get('assignmentId')?.toString();
  const problemId = formData.get('problemId')?.toString();
  const file = formData.get('file') as File | null;
  const { maxBytes, maxMb } = await getSystemUploadLimit();

  if (!assignmentId || !problemId) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'SUBMISSION_INVALID_REQUEST',
      severity: 'WARNING',
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
      severity: 'WARNING',
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
      courseId: true,
      dueDate: true,
      allowLateSubmissions: true,
      lateCutoff: true,
    },
  });

  if (!assignment) {
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'SUBMISSION_INVALID_REQUEST',
      severity: 'WARNING',
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

  // Use the assignment's course as the source of truth rather than trusting the
  // client-supplied courseId, which may be missing or refer to a different course.
  courseId = assignment.courseId;

  // Authorization: admins may submit to any course; everyone else (students,
  // faculty, TAs) must be on the course roster (enrolled or assigned).
  if (session.user.role !== 'ADMIN' && prisma.roster?.findFirst) {
    const rosterEntry = await prisma.roster.findFirst({
      where: { courseId, userId: session.user.id },
      select: { id: true },
    });

    if (!rosterEntry) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'SUBMISSION_FORBIDDEN',
        severity: 'SECURITY',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: session.user.id,
          courseId,
          assignmentId,
          problemId,
          role: session.user.role,
          error: 'User is not enrolled in or assigned to this course.',
        },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // Rate limit: enforce a short cooldown between submissions to the same problem
  // so a single student cannot flood the evaluation queue with rapid resubmits.
  const { resubmitCooldownMs } = await getQueueSettings();
  if (resubmitCooldownMs > 0) {
    const lastSubmission = await prisma.submission.findFirst({
      where: { assignmentId, problemId, studentId: session.user.id },
      orderBy: { submittedAt: 'desc' },
      select: { submittedAt: true },
    });

    if (lastSubmission) {
      const elapsedMs = Date.now() - lastSubmission.submittedAt.getTime();
      if (elapsedMs < resubmitCooldownMs) {
        const retryAfterSec = Math.ceil((resubmitCooldownMs - elapsedMs) / 1000);

        await createEnhancedActivityLog(prisma, req, {
          userId: session.user.id,
          action: 'SUBMISSION_RATE_LIMITED',
          severity: 'WARNING',
          category: 'SUBMISSION',
          courseId,
          assignmentId,
          problemId,
          metadata: {
            userId: session.user.id,
            courseId,
            assignmentId,
            problemId,
            cooldownMs: resubmitCooldownMs,
            elapsedMs,
          },
        });

        return NextResponse.json(
          { error: `Please wait ${retryAfterSec}s before resubmitting to this problem.` },
          { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
        );
      }
    }
  }

  const now = new Date();
  const isLate = now > assignment.dueDate;

  if (isLate) {
    if (!assignment.allowLateSubmissions) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'SUBMISSION_REJECTED_LATE',
        severity: 'WARNING',
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
        severity: 'WARNING',
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
  let uploadedFilePath: string | null = null;

  if (file) {
    // Reject oversized uploads before reading the file into memory
    if (file.size > maxBytes) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'SUBMISSION_FILE_TOO_LARGE',
        severity: 'WARNING',
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
          maxBytes,
        },
      });
      return NextResponse.json(
        { error: `File exceeds max upload size (${maxMb} MB).` },
        { status: 413 },
      );
    }

    const xml = await file.text();
    const validation = validateStructureXML(xml, link.problem.type);

    // Error check
    if (!validation.isValid) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'SUBMISSION_INVALID_FILE_STRUCTURE',
        severity: 'WARNING',
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
        severity: 'INFO',
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
      originalFileName = file.name;
      const fileExt = path.extname(originalFileName);
      fileName = `${randomUUID()}${fileExt}`;

      const uploadDir = path.join('/private', 'uploads', 'submissions');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer, { mode: 0o644 });
      uploadedFilePath = filePath;
    }

    // 5. Store the submission
    const submission = await prisma.submission.create({
      data: {
        courseId: assignment.courseId,
        assignmentId,
        problemId,
        studentId: session.user.id,
        fileName,
        originalFileName,
        feedback: null,
        correct: undefined,
        evaluationRaw: Prisma.JsonNull,
      },
    });

    if (fileName) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'SUBMISSION_FILE_STORED',
        severity: 'INFO',
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
      severity: 'INFO',
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

    return NextResponse.json(submission, { status: 202 });
  } catch (error: unknown) {
    // Clean up the orphaned upload if the submission record was never created
    if (uploadedFilePath) {
      try {
        fs.unlinkSync(uploadedFilePath);
      } catch (cleanupError) {
        console.error('Failed to clean up orphaned submission file:', cleanupError);
      }
    }

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'SUBMISSION_ERROR',
      severity: 'ERROR',
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
