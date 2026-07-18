// src/lib/create-submission.ts
//
// The whole submission-creation pipeline, extracted so the browser route
// (`/api/submissions`) and the native-client route (`/api/client/v1/submissions`)
// create submissions through identical code: same validation, caps, cooldown, late
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
import { evaluateSubmissionWindow } from '@/lib/submission-window';
import { effectiveDeadline } from '@/lib/effective-deadline';
import { isStudentAssigned } from '@/lib/assignment-visibility';

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
  /** The originating request, used only for audit-log IP/UA context. */
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
      unlockAt: true,
      dueDate: true,
      allowLateSubmissions: true,
      lateCutoff: true,
      isPublished: true,
      assignedToEveryone: true,
      // The overrides that apply to this submitter: their own STUDENT override and/or
      // the GROUP override for a group they belong to (at most one of each; a student is
      // never targeted both ways). Drives the effective window and, for a group target,
      // the group submission set.
      overrides: {
        where: {
          OR: [
            { userId: user.id },
            { studentGroup: { memberships: { some: { userId: user.id } } } },
          ],
        },
        select: {
          targetType: true,
          userId: true,
          groupId: true,
          unlockAt: true,
          dueDate: true,
          lateCutoff: true,
          allowLateSubmissions: true,
        },
      },
    },
  });

  if (!assignment) {
    await audit('SUBMISSION_INVALID_REQUEST', 'WARNING', { error: 'Assignment not found.' });
    return { ok: false, status: 404, error: 'Assignment not found.' };
  }

  // Trust the assignment's course, not the client-supplied courseId.
  const courseId = assignment.courseId;
  ctx.courseId = courseId;

  // If the submitter is group-targeted, they submit into the group's shared set: any
  // member submits, all members share it, and the cap/cooldown count group-wide. At most
  // one group applies (no double-targeting).
  const studentGroupIds = (assignment.overrides ?? [])
    .filter((o) => o.targetType === 'GROUP' && o.groupId != null)
    .map((o) => o.groupId as string);
  const submissionGroupId = studentGroupIds[0] ?? null;
  // Count scope for the per-problem cap + cooldown: the whole group, or just this student.
  const countScope = submissionGroupId
    ? { assignmentId, problemId, studentGroupId: submissionGroupId }
    : { assignmentId, problemId, studentId: user.id };

  // Authorization: admins may submit anywhere; everyone else must be on the roster.
  if (!(await canAccessCourse(user, courseId))) {
    await audit('SUBMISSION_FORBIDDEN', 'SECURITY', {
      error: 'User is not enrolled in or assigned to this course.',
    });
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  const submitterIsStaff = await canManageCourse(user, courseId);

  // Students may only submit to a published assignment; staff may test unpublished
  // ones. Mask as 404 so an unpublished assignment stays invisible to a student.
  if (!assignment.isPublished && !submitterIsStaff) {
    await audit('SUBMISSION_UNPUBLISHED_ASSIGNMENT', 'SECURITY', {
      error: 'Submission to an unpublished assignment by a non-staff user.',
    });
    return { ok: false, status: 404, error: 'Assignment not found.' };
  }

  // "Assign to specific students": a student not assigned this work can't submit to it.
  // Mask as 404, same as unpublished. Staff may always test-submit.
  const submitterAssigned = isStudentAssigned(
    assignment,
    assignment.overrides,
    user.id,
    studentGroupIds,
  );
  if (!submitterAssigned && !submitterIsStaff) {
    await audit('SUBMISSION_NOT_ASSIGNED', 'SECURITY', {
      error: 'Submission to an assignment the student is not assigned.',
    });
    return { ok: false, status: 404, error: 'Assignment not found.' };
  }

  // An archived course is frozen (read-only) for everyone, including staff/admin;
  // it accepts no new submissions.
  if (await isCourseArchived(courseId)) {
    await audit('SUBMISSION_REJECTED_ARCHIVED', 'WARNING', { reason: 'Course is archived.' });
    return {
      ok: false,
      status: 409,
      error: 'This course is archived and no longer accepts submissions.',
    };
  }

  // Per-problem cap (staff exempt; `<= 0` is unlimited). Fast path; the authoritative
  // check runs again inside the serializable transaction below.
  const isCourseStaff = submitterIsStaff;
  if (!isCourseStaff && link.maxSubmissions > 0) {
    const priorCount = await prisma.submission.count({ where: countScope });
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
      where: countScope,
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

  // Availability + late policy, resolved for this submitter (a per-student override can
  // move any of these). One resolver drives submit, the calendar, and the student views.
  const now = new Date();
  const deadline = effectiveDeadline(
    {
      unlockAt: assignment.unlockAt,
      dueDate: assignment.dueDate,
      allowLateSubmissions: assignment.allowLateSubmissions,
      lateCutoff: assignment.lateCutoff,
    },
    assignment.overrides ?? [],
    user.id,
    studentGroupIds,
  );
  const window = evaluateSubmissionWindow(deadline, now);
  // Course staff (and admins) may test-submit before an assignment unlocks; the
  // not-open gate applies to students only. Staff are still subject to the late window,
  // matching existing behavior.
  if (!window.accepted && !(window.reason === 'not-open' && isCourseStaff)) {
    const meta = {
      unlockAt: deadline.unlockAt ? deadline.unlockAt.toISOString() : null,
      dueDate: deadline.dueDate.toISOString(),
      allowLateSubmissions: deadline.allowLateSubmissions,
      lateCutoff: deadline.lateCutoff ? deadline.lateCutoff.toISOString() : null,
      submittedAt: now.toISOString(),
      overrideSource: deadline.source,
    };
    if (window.reason === 'not-open') {
      await audit('SUBMISSION_REJECTED_NOT_OPEN', 'WARNING', {
        ...meta,
        reason: 'Assignment is not open for submissions yet.',
      });
      return { ok: false, status: 403, error: 'This assignment is not open for submissions yet.' };
    }
    if (window.reason === 'late-not-allowed') {
      await audit('SUBMISSION_REJECTED_LATE', 'WARNING', {
        ...meta,
        reason: 'Late submissions are not allowed for this assignment.',
      });
      return { ok: false, status: 403, error: 'Late submissions are not allowed for this assignment.' };
    }
    await audit('SUBMISSION_REJECTED_LATE_CUTOFF', 'WARNING', {
      ...meta,
      reason: 'Late submission cutoff has passed for this assignment.',
    });
    return { ok: false, status: 403, error: 'Late submission cutoff has passed for this assignment.' };
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
            const priorCount = await tx.submission.count({ where: countScope });
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
              // The group that owns this submission set (null for individual submissions).
              studentGroupId: submissionGroupId,
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
