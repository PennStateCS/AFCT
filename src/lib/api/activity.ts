import type { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog, type EnhancedActivityLogData } from '@/lib/activity-log-utils';
import { canManageCourse, type PermissionUser } from '@/lib/permissions';
import { apiError } from './http';

/**
 * Writes an audit entry without letting a logging failure fail the request.
 *
 * For handlers whose work has already succeeded and been persisted by the time they log:
 * throwing here would report failure for something that did happen, which is a worse lie
 * than a missing log line. The failure is still printed with `scope` so it is traceable.
 *
 * Do NOT reach for this by default. Everywhere else the log is part of the operation and
 * a failure to record it should surface; see the FERPA note in CLAUDE.md.
 */
export async function safeAuditLog(
  scope: string,
  req: Request,
  data: EnhancedActivityLogData,
): Promise<void> {
  try {
    await createEnhancedActivityLog(prisma, req, data);
  } catch (err) {
    console.error(`[${scope}] audit log failed:`, err);
  }
}

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
    assignmentId?: string | null;
    // The domain this denial is about (explicit; categories are never inferred).
    category: EnhancedActivityLogData['category'];
    metadata?: EnhancedActivityLogData['metadata'];
  },
): Promise<NextResponse> {
  await createEnhancedActivityLog(prisma, req, {
    userId: data.userId ?? null,
    action: data.action,
    severity: 'SECURITY',
    category: data.category,
    ...(data.courseId ? { courseId: data.courseId } : {}),
    ...(data.assignmentId ? { assignmentId: data.assignmentId } : {}),
    metadata: data.metadata ?? {},
  });
  return apiError(403, 'Forbidden');
}

/**
 * Records an operational failure at ERROR severity, normalizing the thrown value
 * into a message string (the `err instanceof Error ? err.message : 'unknown error'`
 * ternary that was repeated 20+ times). Returns nothing: the caller chooses its
 * own response (error bodies still vary intentionally by route).
 */
export async function logError(
  req: Request,
  data: {
    userId?: string | null;
    action: string;
    error: unknown;
    // The domain this failure is about (explicit; categories are never inferred).
    category: EnhancedActivityLogData['category'];
    courseId?: string | null;
    assignmentId?: string | null;
    problemId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await createEnhancedActivityLog(prisma, req, {
    userId: data.userId ?? null,
    action: data.action,
    severity: 'ERROR',
    category: data.category,
    ...(data.courseId ? { courseId: data.courseId } : {}),
    ...(data.assignmentId ? { assignmentId: data.assignmentId } : {}),
    ...(data.problemId ? { problemId: data.problemId } : {}),
    metadata: {
      ...(data.metadata ?? {}),
      error: data.error instanceof Error ? data.error.message : 'unknown error',
    },
  });
}

/**
 * Deny access while **hiding existence from students**: a caller who is course staff
 * or a system admin gets **403 Forbidden** (they may legitimately know the resource
 * exists), while anyone else gets **404 Not Found**, the same response as a resource
 * that doesn't exist, so a student can't probe for hidden courses/assignments. This is
 * the single home for invariant #6's 404-vs-403 masking. Not logged (it's not a
 * privilege escalation, just a scoped not-found).
 */
export async function denyExistence(user: PermissionUser, courseId: string): Promise<NextResponse> {
  return (await canManageCourse(user, courseId))
    ? apiError(403, 'Forbidden')
    : apiError(404, 'Not found');
}

/**
 * Record a staff/admin action that **affects a student** (grade override,
 * submit-on-behalf, password reset, un-enroll, account lifecycle). Enforces the audit
 * shape the logging policy requires: actor, action, target, course, and an optional
 * before/after, so these high-value entries can't be logged half-populated. INFO by
 * default; pass `severity` to override.
 */
export async function logStudentImpactAction(
  req: Request,
  data: {
    actorId: string;
    action: string;
    targetUserId: string;
    category: EnhancedActivityLogData['category'];
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
    category: data.category,
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
    category: EnhancedActivityLogData['category'];
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
    category: data.category,
    courseId: data.courseId ?? null,
    assignmentId: data.assignmentId ?? null,
    problemId: data.problemId ?? null,
    submissionId: data.submissionId ?? null,
    metadata: metadata as EnhancedActivityLogData['metadata'],
  });
}

/** What a changed field can be recorded as. Scalars only: this goes in a JSON column. */
type LoggableValue = string | number | boolean | null;

/**
 * What actually changed, as old and new values side by side.
 *
 * The recurring gap in AFCT's logs: an update records which fields moved and what they are
 * now, so "who changed the due date" is answerable and "from when" is not. Accountability
 * needs both halves, and so does anybody debugging a complaint about a deadline.
 *
 * Only fields that really differ are included, so a save that touched nothing logs nothing.
 * Dates are compared by value rather than identity, or every save would look like a change.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  /** Which fields to compare. Defaults to whatever is being written. */
  fields: readonly string[] = Object.keys(after),
): Record<string, { from: LoggableValue; to: LoggableValue }> {
  const changes: Record<string, { from: LoggableValue; to: LoggableValue }> = {};

  // Kept JSON-safe, because this ends up in a metadata column. Anything richer than a scalar
  // is rendered rather than stored raw: a log is for reading, not for reconstructing objects.
  const normalise = (value: unknown): LoggableValue => {
    if (value instanceof Date) return value.toISOString();
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return String(value);
  };

  for (const key of fields) {
    const from = normalise(before[key]);
    const to = normalise(after[key]);
    if (from !== to) changes[key] = { from, to };
  }

  return changes;
}
