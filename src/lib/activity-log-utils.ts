/**
 * Utility functions for enhanced ActivityLog system
 * Note: This requires the enhanced ActivityLog schema with foreign keys
 */

import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { getClientIp } from './ip-utils';

export type ActivityCategory =
  | 'SYSTEM' // Login, logout, session extend
  | 'USER' // User CRUD, password changes
  | 'COURSE' // Course CRUD, enrollment
  | 'ASSIGNMENT' // Assignment CRUD, publishing
  | 'PROBLEM' // Problem CRUD
  | 'SUBMISSION'; // Submission CRUD, grading

export type LogSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'SECURITY';

/**
 * Classify an action into a severity from its name. Our actions follow a
 * consistent verb/outcome convention, so the suffix reliably encodes intent:
 *   - access-control denials and auth failures  -> SECURITY
 *   - operational failures (…_ERROR)             -> ERROR
 *   - expected rejections / invalid input        -> WARNING
 *   - everything else (normal activity)          -> INFO
 * Callers may pass an explicit severity to override this.
 */
export function inferSeverity(action: string): LogSeverity {
  const a = action.toUpperCase();
  const isAuth = a.includes('LOGIN') || a.includes('SIGNUP') || a.includes('AUTH');

  if (a.includes('DENIED') || a.includes('UNAUTHORIZED') || a.includes('FORBIDDEN')) {
    return 'SECURITY';
  }
  if (a.includes('CHALLENGE_REQUIRED')) return 'SECURITY';
  if (isAuth && (a.includes('FAILED') || a.includes('RATE_LIMIT'))) return 'SECURITY';

  if (a.includes('ERROR')) return 'ERROR';

  if (
    a.includes('REJECTED') ||
    a.includes('INVALID') ||
    a.includes('TOO_LARGE') ||
    a.includes('RATE_LIMIT') ||
    a.includes('FAILED') ||
    a.includes('STDERR')
  ) {
    return 'WARNING';
  }

  return 'INFO';
}

export interface EnhancedActivityLogData {
  userId?: string | null;
  action: string;
  timestamp?: Date;
  category?: ActivityCategory;
  /**
   * Required and explicit at every call site — the severity of an entry is a
   * deliberate classification, not something to guess from the action name.
   * (`inferSeverity` remains available for callers that genuinely want name-based
   * derivation, but they must opt in by passing `severity: inferSeverity(action)`.)
   */
  severity: LogSeverity;
  courseId?: string | null;
  assignmentId?: string | null;
  problemId?: string | null;
  submissionId?: string | null;
  // Prisma JSON input type for flexible structured metadata
  metadata?: Prisma.InputJsonValue | null;
  /**
   * When true (default), the helper will attach human-readable context such as
   * course names or assignment titles based on the provided foreign keys.
   */
  includeDisplayMetadata?: boolean;
}

/**
 * Determines the activity category from the action string
 */
export function getActivityCategory(action: string): ActivityCategory {
  const upperAction = action.toUpperCase();

  if (
    upperAction.includes('LOGIN') ||
    upperAction.includes('LOGOUT') ||
    upperAction.includes('SESSION')
  ) {
    return 'SYSTEM';
  }
  if (
    upperAction.includes('USER') ||
    upperAction.includes('PASSWORD') ||
    upperAction.includes('PROFILE')
  ) {
    return 'USER';
  }
  if (upperAction.includes('COURSE') || upperAction.includes('ENROLL')) {
    return 'COURSE';
  }
  if (upperAction.includes('ASSIGNMENT')) {
    return 'ASSIGNMENT';
  }
  if (upperAction.includes('PROBLEM')) {
    return 'PROBLEM';
  }
  if (upperAction.includes('SUBMISSION') || upperAction.includes('GRADE')) {
    return 'SUBMISSION';
  }

  return 'SYSTEM'; // Default fallback
}

/**
 * Query builders for common activity log filters
 */
export const ActivityLogQueries = {
  // Get all activities for a course
  forCourse: (courseId: string, limit = 50) => ({
    where: { courseId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, avatar: true } },
      course: { select: { name: true, code: true } },
    },
    orderBy: { timestamp: 'desc' as const },
    take: limit,
  }),

  // Get activities for an assignment
  forAssignment: (assignmentId: string, limit = 50) => ({
    where: { assignmentId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, avatar: true } },
      assignment: { select: { title: true } },
    },
    orderBy: { timestamp: 'desc' as const },
    take: limit,
  }),

  // Get user activities in a course
  forUserInCourse: (userId: string, courseId: string, limit = 50) => ({
    where: { userId, courseId },
    include: {
      course: { select: { name: true, code: true } },
      assignment: { select: { title: true } },
      problem: { select: { title: true } },
    },
    orderBy: { timestamp: 'desc' as const },
    take: limit,
  }),

  // Get activities by category
  byCategory: (category: ActivityCategory, limit = 50) => ({
    where: { category },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, avatar: true } },
    },
    orderBy: { timestamp: 'desc' as const },
    take: limit,
  }),

  // Get recent system activities (logins, etc.)
  systemActivities: (limit = 100) => ({
    where: { category: 'SYSTEM' as const },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, avatar: true } },
    },
    orderBy: { timestamp: 'desc' as const },
    take: limit,
  }),

  // Get activities with date range
  inDateRange: (
    startDate: Date,
    endDate: Date,
    filters?: { courseId?: string; category?: ActivityCategory },
  ) => ({
    where: {
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
      ...filters,
    },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, avatar: true } },
      course: { select: { name: true, code: true } },
      assignment: { select: { title: true } },
      problem: { select: { title: true } },
    },
    orderBy: { timestamp: 'desc' as const },
  }),
};

/**
 * Verify the actor exists and return the id that's safe to store plus the display
 * fields for enrichment. On a missing user (or a lookup failure) the id is dropped to
 * null so the log still records without a dangling FK.
 */
async function resolveActor(
  prisma: PrismaClient,
  userId: string | null,
): Promise<{
  safeUserId: string | null;
  display: { firstName: string | null; lastName: string | null; email: string | null } | null;
}> {
  if (!userId) return { safeUserId: null, display: null };
  try {
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!userRecord) return { safeUserId: null, display: null };
    return { safeUserId: userRecord.id, display: userRecord };
  } catch {
    // Best-effort enrichment; never let a lookup failure break logging.
    return { safeUserId: null, display: null };
  }
}

/**
 * Human-readable names/titles for the referenced course/assignment/problem/submission,
 * as a metadata fragment. Best-effort: a lookup failure yields an empty fragment rather
 * than breaking the write.
 */
async function resolveEntityDisplay(
  prisma: PrismaClient,
  ids: {
    courseId?: string | null;
    assignmentId?: string | null;
    problemId?: string | null;
    submissionId?: string | null;
  },
): Promise<Record<string, unknown>> {
  const meta: Record<string, unknown> = {};
  try {
    const [courseRecord, assignmentRecord, problemRecord, submissionRecord] = await Promise.all([
      ids.courseId
        ? prisma.course.findUnique({ where: { id: ids.courseId }, select: { name: true, code: true } })
        : Promise.resolve(null),
      ids.assignmentId
        ? prisma.assignment.findUnique({ where: { id: ids.assignmentId }, select: { title: true } })
        : Promise.resolve(null),
      ids.problemId
        ? prisma.problem.findUnique({ where: { id: ids.problemId }, select: { title: true } })
        : Promise.resolve(null),
      ids.submissionId
        ? prisma.submission.findUnique({
            where: { id: ids.submissionId },
            select: { fileName: true, originalFileName: true },
          })
        : Promise.resolve(null),
    ]);

    if (courseRecord?.name) meta.courseName = courseRecord.name;
    if (courseRecord?.code) meta.courseCode = courseRecord.code;
    if (assignmentRecord?.title) meta.assignmentTitle = assignmentRecord.title;
    if (problemRecord?.title) meta.problemTitle = problemRecord.title;
    if (submissionRecord?.originalFileName) {
      meta.submissionOriginalFileName = submissionRecord.originalFileName;
    }
    if (submissionRecord?.fileName) meta.submissionFileName = submissionRecord.fileName;
  } catch {
    // Best-effort enrichment; never let a lookup failure break logging.
  }
  return meta;
}

/**
 * Write the row. Swallows FK races (P2003) and never throws — audit logging must not
 * break the request it is recording.
 */
async function persistLog(
  prisma: PrismaClient,
  row: Prisma.ActivityLogUncheckedCreateInput,
): Promise<void> {
  try {
    await prisma.activityLog.create({ data: row });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      // Foreign key violation (e.g., race or another stale FK) — log and continue
      console.warn('[ActivityLog] FK violation skipped (P2003):', err.meta);
      return;
    }
    console.error('[ActivityLog] write failed:', err);
  }
}

/**
 * Enhanced activity log creation helper. Orchestrates the three steps:
 * - resolve the actor (verify the user; drop a dangling FK)
 * - resolve display metadata (course/assignment/problem/submission names)
 * - persist the row (categorized, with IP/UA, swallowing FK races)
 */
export async function createEnhancedActivityLog(
  prisma: PrismaClient,
  // Either a Request (API routes) or a pre-resolved client context. NextAuth event
  // callbacks and credential verification run without a Request, so they pass the
  // IP/UA they already have instead — one write path for every log site.
  reqOrContext: Request | { ipAddress?: string | null; userAgent?: string | null },
  data: EnhancedActivityLogData,
): Promise<void> {
  const category = data.category || getActivityCategory(data.action);
  const ipAddress =
    reqOrContext instanceof Request ? getClientIp(reqOrContext) : (reqOrContext.ipAddress ?? null);
  const userAgent =
    reqOrContext instanceof Request
      ? reqOrContext.headers.get('user-agent') || undefined
      : (reqOrContext.userAgent ?? undefined);
  const includeDisplayMetadata = data.includeDisplayMetadata !== false;

  const baseMetadata: Record<string, unknown> =
    data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? { ...(data.metadata as Record<string, unknown>) }
      : data.metadata !== undefined
        ? { value: data.metadata }
        : {};

  const { safeUserId, display } = await resolveActor(prisma, data.userId ?? null);

  if (includeDisplayMetadata && display) {
    const displayName = [display.firstName, display.lastName].filter(Boolean).join(' ').trim();
    if (displayName) baseMetadata.userName = displayName;
    if (display.email) baseMetadata.userEmail = display.email;
  }

  if (includeDisplayMetadata) {
    Object.assign(baseMetadata, await resolveEntityDisplay(prisma, data));
  }

  await persistLog(prisma, {
    userId: safeUserId,
    action: data.action,
    category,
    severity: data.severity,
    courseId: data.courseId ?? null,
    assignmentId: data.assignmentId ?? null,
    problemId: data.problemId ?? null,
    submissionId: data.submissionId ?? null,
    ipAddress,
    userAgent,
    // Ensure a Prisma-compatible JSON value; default to empty object
    metadata: (baseMetadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
  });
}
