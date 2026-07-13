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
import { createEnhancedActivityLog, type LogSeverity } from '@/lib/activity-log-utils';
import { getSystemUploadLimit } from '@/lib/upload-limits';
import { getQueueSettings } from '@/lib/eval-config';
import { validateStructureXML } from '@/app/utils/xmlStructureValidate';
import { canAccessCourse, canManageCourse, isCourseArchived } from '@/lib/permissions';
import { safeStoredFilename, resolveInsideDir } from '@/lib/safe-upload';
import { errMessage } from '@/lib/errors';

/** Thrown inside the create transaction when the per-problem cap is already met. */
class SubmissionCapReachedError extends Error {}

const SUBMISSION_UPLOAD_DIR = path.join('/private', 'uploads', 'submissions');

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

/** Best-effort delete of an orphaned upload; never throws. */
function cleanupFile(filePath: string | null, onError?: (err: unknown) => void): void {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    onError?.(err);
  }
}

/** Persist an uploaded submission file under the submissions dir; returns its path. */
function storeSubmissionFile(storedName: string, buffer: Buffer): string {
  if (!fs.existsSync(SUBMISSION_UPLOAD_DIR)) {
    fs.mkdirSync(SUBMISSION_UPLOAD_DIR, { recursive: true });
  }
  const filePath = resolveInsideDir(SUBMISSION_UPLOAD_DIR, storedName);
  fs.writeFileSync(filePath, buffer, { mode: 0o644 });
  return filePath;
}

/**
 * Validate + persist a submission. Returns a discriminated result (never a Response),
 * so each caller maps it to its own transport. The row is created `PENDING`; the
 * background worker picks it up.
 */
export async function createSubmission(input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
  const { user, assignmentId, problemId, file, req } = input;
  const { maxBytes, maxMb } = await getSystemUploadLimit();

  // Every submission audit entry shares the same actor + course/assignment/problem/
  // submission identity, recorded both as foreign keys and inside `metadata`. Bind it
  // once here so each call site passes only its distinguishing fields. The context is
  // mutable: `courseId` is filled from the resolved assignment, and `submissionId`
  // once the row exists.
  const ctx = {
    userId: user.id,
    courseId: input.courseId,
    assignmentId,
    problemId,
    submissionId: undefined as string | undefined,
  };
  const audit = (action: string, severity: LogSeverity, meta: Record<string, unknown> = {}) =>
    createEnhancedActivityLog(prisma, req, {
      userId: ctx.userId,
      action,
      severity,
      category: 'SUBMISSION',
      courseId: ctx.courseId,
      assignmentId: ctx.assignmentId,
      problemId: ctx.problemId,
      submissionId: ctx.submissionId ?? null,
      metadata: {
        userId: ctx.userId,
        courseId: ctx.courseId,
        assignmentId: ctx.assignmentId,
        problemId: ctx.problemId,
        ...(ctx.submissionId ? { submissionId: ctx.submissionId } : {}),
        ...meta,
      },
    });

  if (!assignmentId || !problemId) {
    await audit('SUBMISSION_INVALID_REQUEST', 'WARNING', { error: 'Missing required fields' });
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
    await audit('SUBMISSION_INVALID_REQUEST', 'WARNING', {
      error: 'Problem is not linked to this assignment.',
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
    await audit('SUBMISSION_INVALID_REQUEST', 'WARNING', { error: 'Assignment not found.' });
    return { ok: false, status: 404, error: 'Assignment not found.' };
  }

  // Trust the assignment's course, not the client-supplied courseId.
  const courseId = assignment.courseId;
  ctx.courseId = courseId;

  // Authorization: admins may submit anywhere; everyone else must be on the roster.
  if (!(await canAccessCourse(user, courseId))) {
    await audit('SUBMISSION_FORBIDDEN', 'SECURITY', {
      error: 'User is not enrolled in or assigned to this course.',
    });
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  // Students may only submit to a published assignment; staff may test unpublished
  // ones. Mask as 404 so an unpublished assignment stays invisible to a student.
  if (!assignment.isPublished && !(await canManageCourse(user, courseId))) {
    await audit('SUBMISSION_UNPUBLISHED_ASSIGNMENT', 'SECURITY', {
      error: 'Submission to an unpublished assignment by a non-staff user.',
    });
    return { ok: false, status: 404, error: 'Assignment not found.' };
  }

  // An archived course is frozen (read-only) for everyone, including staff/admin —
  // it accepts no new submissions.
  if (await isCourseArchived(courseId)) {
    await audit('SUBMISSION_REJECTED_ARCHIVED', 'WARNING', { reason: 'Course is archived.' });
    return {
      ok: false,
      status: 409,
      error: 'This course is archived and no longer accepts submissions.',
    };
  }

  // Per-problem cap (staff exempt; `<= 0` is unlimited). Fast path — the authoritative
  // check runs again inside the serializable transaction below.
  const isCourseStaff = await canManageCourse(user, courseId);
  if (!isCourseStaff && link.maxSubmissions > 0) {
    const priorCount = await prisma.submission.count({
      where: { assignmentId, problemId, studentId: user.id },
    });
    if (priorCount >= link.maxSubmissions) {
      await audit('SUBMISSION_LIMIT_REACHED', 'WARNING', {
        maxSubmissions: link.maxSubmissions,
        priorCount,
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
        await audit('SUBMISSION_RATE_LIMITED', 'WARNING', {
          cooldownMs: resubmitCooldownMs,
          elapsedMs,
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
      await audit('SUBMISSION_REJECTED_LATE', 'WARNING', {
        dueDate: assignment.dueDate.toISOString(),
        allowLateSubmissions: assignment.allowLateSubmissions,
        lateCutoff: assignment.lateCutoff ? assignment.lateCutoff.toISOString() : null,
        submittedAt: now.toISOString(),
        reason: 'Late submissions are not allowed for this assignment.',
      });
      return { ok: false, status: 403, error: 'Late submissions are not allowed for this assignment.' };
    }
    if (assignment.lateCutoff && now > assignment.lateCutoff) {
      await audit('SUBMISSION_REJECTED_LATE_CUTOFF', 'WARNING', {
        dueDate: assignment.dueDate.toISOString(),
        allowLateSubmissions: assignment.allowLateSubmissions,
        lateCutoff: assignment.lateCutoff.toISOString(),
        submittedAt: now.toISOString(),
        reason: 'Late submission cutoff has passed for this assignment.',
      });
      return { ok: false, status: 403, error: 'Late submission cutoff has passed for this assignment.' };
    }
  }

  let fileName: string | null = null;
  let originalFileName: string | null = null;

  if (file) {
    if (file.size > maxBytes) {
      await audit('SUBMISSION_FILE_TOO_LARGE', 'WARNING', {
        fileName: file.name,
        fileSizeBytes: file.size,
        maxBytes,
      });
      return { ok: false, status: 413, error: `File exceeds max upload size (${maxMb} MB).` };
    }

    const xml = await file.text();
    const validation = validateStructureXML(xml, link.problem.type);
    if (!validation.isValid) {
      await audit('SUBMISSION_INVALID_FILE_STRUCTURE', 'WARNING', { error: validation.error });
      return { ok: false, status: 400, error: validation.error ?? 'Invalid file structure.' };
    }
  }

  let uploadedFilePath: string | null = null;

  try {
    if (file) {
      await audit('SUBMISSION_FILE_RECEIVED', 'INFO', {
        fileName: file.name,
        fileSizeBytes: file.size,
        fileType: file.type,
      });
      originalFileName = file.name;
      // Random UUID + whitelisted extension; never a client-controlled path.
      fileName = safeStoredFilename(originalFileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      uploadedFilePath = storeSubmissionFile(fileName, buffer);
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
      cleanupFile(uploadedFilePath);
      if (err instanceof SubmissionCapReachedError) {
        return { ok: false, status: 409, error: `Submission limit reached (${link.maxSubmissions}).` };
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
        return { ok: false, status: 409, error: 'A concurrent submission conflicted; please retry.' };
      }
      throw err;
    }

    ctx.submissionId = submission.id;

    if (fileName) {
      await audit('SUBMISSION_FILE_STORED', 'INFO', { fileName, originalFileName });
    }

    await audit('SUBMISSION_CREATED', 'INFO', { fileName, status: 'PENDING' });

    return { ok: true, submission };
  } catch (error: unknown) {
    cleanupFile(uploadedFilePath, (cleanupError) =>
      console.error('Failed to clean up orphaned submission file:', cleanupError),
    );
    await audit('SUBMISSION_ERROR', 'ERROR', { error: errMessage(error), status: 'FAILED' });
    return { ok: false, status: 500, error: 'Failed to create submission' };
  }
}
