// src/lib/create-submission.ts
//
// The whole submission-creation pipeline, extracted so the browser route
// (`/api/submissions`) and the native-client route (`/api/client/v1/submissions`)
// create submissions through identical code — same validation, caps, cooldown, late
// window, storage, serializable insert, audit logging, and the same PENDING → worker
// queue. Callers do their own authentication first and pass the resolved user.
import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { getQueueSettings } from '@/lib/eval-config';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';
import { canAccessCourse, canManageCourse } from '@/lib/permissions';
import { safeStoredFilename, resolveInsideDir } from '@/lib/safe-upload';

/** Thrown inside the create transaction when the per-problem cap is already met. */
class SubmissionCapReachedError extends Error {}

type SubmissionUser = { id: string; isAdmin?: boolean | null };

export type CreateSubmissionInput = {
  /** The authenticated submitter (session user or client token user). */
  user: SubmissionUser;
  /** Client-supplied course hint; ignored once the assignment is resolved. */
  courseId?: string;
  assignmentId?: string;
  problemId?: string;
  file: File | null;
  /** The originating request — used only for audit-log IP/UA context. */
  req: Request;
};

export type CreateSubmissionResult =
  | { ok: true; submission: Prisma.SubmissionGetPayload<object> }
  | { ok: false; status: number; error: string; headers?: Record<string, string> };

/**
 * Validate + persist a submission. Returns a discriminated result (never a Response),
 * so each caller maps it to its own transport. The row is created `PENDING`; the
 * background worker picks it up.
 */
export async function createSubmission(input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
  const { user, assignmentId, problemId, file, req } = input;
  let courseId = input.courseId;
  const { maxBytes, maxMb } = await getSystemUploadLimit();

  if (!assignmentId || !problemId) {
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'SUBMISSION_INVALID_REQUEST',
      severity: 'WARNING',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: { userId: user.id, courseId, assignmentId, problemId, error: 'Missing required fields' },
    });
    return { ok: false, status: 400, error: 'Missing required fields' };
  }

  // The problem must be linked to the assignment.
  const link = await prisma.assignmentProblem.findUnique({
    where: { assignmentId_problemId: { assignmentId, problemId } },
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
      userId: user.id,
      action: 'SUBMISSION_INVALID_REQUEST',
      severity: 'WARNING',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: user.id,
        courseId,
        assignmentId,
        problemId,
        error: 'Problem is not linked to this assignment.',
      },
    });
    return { ok: false, status: 400, error: 'Problem is not linked to this assignment.' };
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      courseId: true,
      dueDate: true,
      allowLateSubmissions: true,
      lateCutoff: true,
      isPublished: true,
    },
  });

  if (!assignment) {
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'SUBMISSION_INVALID_REQUEST',
      severity: 'WARNING',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: { userId: user.id, courseId, assignmentId, problemId, error: 'Assignment not found.' },
    });
    return { ok: false, status: 404, error: 'Assignment not found.' };
  }

  // Trust the assignment's course, not the client-supplied courseId.
  courseId = assignment.courseId;

  // Authorization: admins may submit anywhere; everyone else must be on the roster.
  if (!(await canAccessCourse(user, courseId))) {
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'SUBMISSION_FORBIDDEN',
      severity: 'SECURITY',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: user.id,
        courseId,
        assignmentId,
        problemId,
        error: 'User is not enrolled in or assigned to this course.',
      },
    });
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  // Students may only submit to a published assignment; staff may test unpublished
  // ones. Mask as 404 so an unpublished assignment stays invisible to a student.
  if (!assignment.isPublished && !(await canManageCourse(user, courseId))) {
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'SUBMISSION_UNPUBLISHED_ASSIGNMENT',
      severity: 'SECURITY',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: user.id,
        courseId,
        assignmentId,
        problemId,
        error: 'Submission to an unpublished assignment by a non-staff user.',
      },
    });
    return { ok: false, status: 404, error: 'Assignment not found.' };
  }

  // Per-problem cap (staff exempt; `<= 0` is unlimited). Fast path — the authoritative
  // check runs again inside the serializable transaction below.
  const isCourseStaff = await canManageCourse(user, courseId);
  if (!isCourseStaff && link.maxSubmissions > 0) {
    const priorCount = await prisma.submission.count({
      where: { assignmentId, problemId, studentId: user.id },
    });
    if (priorCount >= link.maxSubmissions) {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SUBMISSION_LIMIT_REACHED',
        severity: 'WARNING',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: user.id,
          courseId,
          assignmentId,
          problemId,
          maxSubmissions: link.maxSubmissions,
          priorCount,
        },
      });
      return { ok: false, status: 409, error: `Submission limit reached (${link.maxSubmissions}).` };
    }
  }

  // Resubmit cooldown.
  const { resubmitCooldownMs } = await getQueueSettings();
  if (resubmitCooldownMs > 0) {
    const lastSubmission = await prisma.submission.findFirst({
      where: { assignmentId, problemId, studentId: user.id },
      orderBy: { submittedAt: 'desc' },
      select: { submittedAt: true },
    });
    if (lastSubmission) {
      const elapsedMs = Date.now() - lastSubmission.submittedAt.getTime();
      if (elapsedMs < resubmitCooldownMs) {
        const retryAfterSec = Math.ceil((resubmitCooldownMs - elapsedMs) / 1000);
        await createEnhancedActivityLog(prisma, req, {
          userId: user.id,
          action: 'SUBMISSION_RATE_LIMITED',
          severity: 'WARNING',
          category: 'SUBMISSION',
          courseId,
          assignmentId,
          problemId,
          metadata: {
            userId: user.id,
            courseId,
            assignmentId,
            problemId,
            cooldownMs: resubmitCooldownMs,
            elapsedMs,
          },
        });
        return {
          ok: false,
          status: 429,
          error: `Please wait ${retryAfterSec}s before resubmitting to this problem.`,
          headers: { 'Retry-After': String(retryAfterSec) },
        };
      }
    }
  }

  // Late policy.
  const now = new Date();
  if (now > assignment.dueDate) {
    if (!assignment.allowLateSubmissions) {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SUBMISSION_REJECTED_LATE',
        severity: 'WARNING',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: user.id,
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
      return { ok: false, status: 403, error: 'Late submissions are not allowed for this assignment.' };
    }
    if (assignment.lateCutoff && now > assignment.lateCutoff) {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SUBMISSION_REJECTED_LATE_CUTOFF',
        severity: 'WARNING',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: user.id,
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
      return { ok: false, status: 403, error: 'Late submission cutoff has passed for this assignment.' };
    }
  }

  let fileName: string | null = null;
  let originalFileName: string | null = null;
  let uploadedFilePath: string | null = null;

  if (file) {
    if (file.size > maxBytes) {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SUBMISSION_FILE_TOO_LARGE',
        severity: 'WARNING',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: user.id,
          courseId,
          assignmentId,
          problemId,
          fileName: file.name,
          fileSizeBytes: file.size,
          maxBytes,
        },
      });
      return { ok: false, status: 413, error: `File exceeds max upload size (${maxMb} MB).` };
    }

    const xml = await file.text();
    const validation = validateStructureXML(xml, link.problem.type);
    if (!validation.isValid) {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SUBMISSION_INVALID_FILE_STRUCTURE',
        severity: 'WARNING',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: { userId: user.id, courseId, assignmentId, problemId, error: validation.error },
      });
      return { ok: false, status: 400, error: validation.error ?? 'Invalid file structure.' };
    }
  }

  try {
    if (file) {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SUBMISSION_FILE_RECEIVED',
        severity: 'INFO',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        metadata: {
          userId: user.id,
          courseId,
          assignmentId,
          problemId,
          fileName: file.name,
          fileSizeBytes: file.size,
          fileType: file.type,
        },
      });
      originalFileName = file.name;
      // Random UUID + whitelisted extension; never a client-controlled path.
      fileName = safeStoredFilename(originalFileName);

      const uploadDir = path.join('/private', 'uploads', 'submissions');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const filePath = resolveInsideDir(uploadDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(filePath, buffer, { mode: 0o644 });
      uploadedFilePath = filePath;
    }

    // Re-check the cap inside a serializable transaction so concurrent submits can't
    // both slip past the earlier count.
    let submission: Prisma.SubmissionGetPayload<object>;
    try {
      submission = await prisma.$transaction(
        async (tx) => {
          if (!isCourseStaff && link.maxSubmissions > 0) {
            const priorCount = await tx.submission.count({
              where: { assignmentId, problemId, studentId: user.id },
            });
            if (priorCount >= link.maxSubmissions) {
              throw new SubmissionCapReachedError();
            }
          }
          return tx.submission.create({
            data: {
              courseId: assignment.courseId,
              assignmentId,
              problemId,
              studentId: user.id,
              fileName,
              originalFileName,
              feedback: null,
              correct: undefined,
              evaluationRaw: Prisma.JsonNull,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (uploadedFilePath) {
        try {
          fs.unlinkSync(uploadedFilePath);
        } catch {
          // best-effort cleanup
        }
      }
      if (err instanceof SubmissionCapReachedError) {
        return { ok: false, status: 409, error: `Submission limit reached (${link.maxSubmissions}).` };
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        return { ok: false, status: 409, error: 'A concurrent submission conflicted; please retry.' };
      }
      throw err;
    }

    if (fileName) {
      await createEnhancedActivityLog(prisma, req, {
        userId: user.id,
        action: 'SUBMISSION_FILE_STORED',
        severity: 'INFO',
        category: 'SUBMISSION',
        courseId,
        assignmentId,
        problemId,
        submissionId: submission.id,
        metadata: {
          userId: user.id,
          courseId,
          assignmentId,
          problemId,
          submissionId: submission.id,
          fileName,
          originalFileName,
        },
      });
    }

    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'SUBMISSION_CREATED',
      severity: 'INFO',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      submissionId: submission.id,
      metadata: {
        userId: user.id,
        courseId,
        assignmentId,
        problemId,
        submissionId: submission.id,
        fileName,
        status: 'PENDING',
      },
    });

    return { ok: true, submission };
  } catch (error: unknown) {
    if (uploadedFilePath) {
      try {
        fs.unlinkSync(uploadedFilePath);
      } catch (cleanupError) {
        console.error('Failed to clean up orphaned submission file:', cleanupError);
      }
    }
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: 'SUBMISSION_ERROR',
      severity: 'ERROR',
      category: 'SUBMISSION',
      courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: user.id,
        courseId,
        assignmentId,
        problemId,
        error: error instanceof Error ? error.message : String(error),
        status: 'FAILED',
      },
    });
    return { ok: false, status: 500, error: 'Failed to create submission' };
  }
}
