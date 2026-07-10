import type { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  createEnhancedActivityLog,
  type EnhancedActivityLogData,
} from '@/lib/activity-log-utils';
import { canManageCourse, type PermissionUser } from '@/lib/permissions';
import { apiError } from './http';

/**
 * Records a SECURITY denial in the audit log and returns a 403 Forbidden. This is
 * the single home for the "log the `*_DENIED` event, then return Forbidden" block
 * that was copy-pasted across ~30 handlers.
 */
export async function logDenial(
  req: Request,
  data: {
    userId?: string | null;
    action: string;
    courseId?: string | null;
    metadata?: EnhancedActivityLogData['metadata'];
  },
): Promise<NextResponse> {
  await createEnhancedActivityLog(prisma, req, {
    userId: data.userId ?? null,
    action: data.action,
    severity: 'SECURITY',
    ...(data.courseId ? { courseId: data.courseId } : {}),
    metadata: data.metadata ?? {},
  });
  return apiError(403, 'Forbidden');
}

/**
 * Records an operational failure at ERROR severity, normalizing the thrown value
 * into a message string (the `err instanceof Error ? err.message : 'unknown error'`
 * ternary that was repeated 20+ times). Returns nothing — the caller chooses its
 * own response (error bodies still vary intentionally by route).
 */
export async function logError(
  req: Request,
  data: {
    userId?: string | null;
    action: string;
    error: unknown;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await createEnhancedActivityLog(prisma, req, {
    userId: data.userId ?? null,
    action: data.action,
    severity: 'ERROR',
    metadata: {
      ...(data.metadata ?? {}),
      error: data.error instanceof Error ? data.error.message : 'unknown error',
    },
  });
}

/**
 * Deny access while **hiding existence from students**: a caller who is course staff
 * or a system admin gets **403 Forbidden** (they may legitimately know the resource
 * exists), while anyone else gets **404 Not Found** — the same response as a resource
 * that doesn't exist, so a student can't probe for hidden courses/assignments. This is
 * the single home for invariant #6's 404-vs-403 masking. Not logged (it's not a
 * privilege escalation, just a scoped not-found).
 */
export async function denyExistence(
  user: PermissionUser,
  courseId: string,
): Promise<NextResponse> {
  return (await canManageCourse(user, courseId)) ? apiError(403, 'Forbidden') : apiError(404, 'Not found');
}

/**
 * Record a staff/admin action that **affects a student** (grade override,
 * submit-on-behalf, password reset, un-enroll, account lifecycle). Enforces the audit
 * shape the logging policy requires — actor, action, target, course, and an optional
 * before/after — so these high-value entries can't be logged half-populated. INFO by
 * default; pass `severity` to override.
 */
export async function logStudentImpactAction(
  req: Request,
  data: {
    actorId: string;
    action: string;
    targetUserId: string;
    courseId?: string | null;
    assignmentId?: string | null;
    before?: unknown;
    after?: unknown;
    severity?: EnhancedActivityLogData['severity'];
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const metadata: Record<string, unknown> = {
    ...(data.metadata ?? {}),
    targetUserId: data.targetUserId,
    ...(data.before !== undefined ? { before: data.before } : {}),
    ...(data.after !== undefined ? { after: data.after } : {}),
  };
  await createEnhancedActivityLog(prisma, req, {
    userId: data.actorId,
    action: data.action,
    severity: data.severity ?? 'INFO',
    courseId: data.courseId ?? null,
    assignmentId: data.assignmentId ?? null,
    metadata: metadata as EnhancedActivityLogData['metadata'],
  });
}

/**
 * Record a successful state change (create/update/delete) at INFO. A thin, consistent
 * wrapper for the "log all writes" rule; pass `changedFields` for updates so the entry
 * explains what moved.
 */
export async function logMutation(
  req: Request,
  data: {
    userId: string;
    action: string;
    courseId?: string | null;
    assignmentId?: string | null;
    problemId?: string | null;
    submissionId?: string | null;
    changedFields?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const metadata: Record<string, unknown> = {
    ...(data.metadata ?? {}),
    ...(data.changedFields ? { changedFields: data.changedFields } : {}),
  };
  await createEnhancedActivityLog(prisma, req, {
    userId: data.userId,
    action: data.action,
    severity: 'INFO',
    courseId: data.courseId ?? null,
    assignmentId: data.assignmentId ?? null,
    problemId: data.problemId ?? null,
    submissionId: data.submissionId ?? null,
    metadata: metadata as EnhancedActivityLogData['metadata'],
  });
}
