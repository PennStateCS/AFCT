/**
 * Utility functions for enhanced ActivityLog system
 * Note: This requires the enhanced ActivityLog schema with foreign keys
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { getClientIp } from './ip-utils';

export type ActivityCategory =
  | 'SYSTEM' // Login, logout, session extend
  | 'USER' // User CRUD, password changes
  | 'COURSE' // Course CRUD, enrollment
  | 'ASSIGNMENT' // Assignment CRUD, publishing
  | 'PROBLEM' // Problem CRUD
  | 'SUBMISSION'; // Submission CRUD, grading

export interface EnhancedActivityLogData {
  userId?: string | null;
  action: string;
  timestamp?: DateTime;
  category?: ActivityCategory;
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
 * Enhanced activity log creation helper
 * - Categorizes the action
 * - Extracts IP/UA
 * - Verifies userId exists (if provided); if not, logs with userId: null
 * - Swallows FK violations (P2003) to avoid 500s in dev
 */
export async function createEnhancedActivityLog(
  prisma: PrismaClient,
  req: Request,
  data: EnhancedActivityLogData,
): Promise<void> {
  const category = data.category || getActivityCategory(data.action);
  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || undefined;
  const includeDisplayMetadata = data.includeDisplayMetadata !== false;

  const baseMetadata: Record<string, unknown> =
    data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? { ...(data.metadata as Record<string, unknown>) }
      : data.metadata !== undefined
        ? { value: data.metadata }
        : {};

  // Verify user exists if a userId was provided
  let safeUserId: string | null = data.userId ?? null;
  let userDisplay: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null = null;
  if (safeUserId) {
    const userRecord = await prisma.user.findUnique({
      where: { id: safeUserId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    if (!userRecord) {
      // Drop the FK so the log still records without crashing
      safeUserId = null;
    } else {
      userDisplay = userRecord;
    }
  }

  if (includeDisplayMetadata && userDisplay) {
    const displayName = [userDisplay.firstName, userDisplay.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (displayName) {
      baseMetadata.userName = displayName;
    }
    if (userDisplay.email) {
      baseMetadata.userEmail = userDisplay.email;
    }
  }

  if (includeDisplayMetadata) {
    const [courseRecord, assignmentRecord, problemRecord, submissionRecord] = await Promise.all([
      data.courseId
        ? prisma.course.findUnique({
            where: { id: data.courseId },
            select: { name: true, code: true },
          })
        : Promise.resolve(null),
      data.assignmentId
        ? prisma.assignment.findUnique({
            where: { id: data.assignmentId },
            select: { title: true },
          })
        : Promise.resolve(null),
      data.problemId
        ? prisma.problem.findUnique({
            where: { id: data.problemId },
            select: { title: true },
          })
        : Promise.resolve(null),
      data.submissionId
        ? prisma.submission.findUnique({
            where: { id: data.submissionId },
            select: { fileName: true, originalFileName: true },
          })
        : Promise.resolve(null),
    ]);

    if (courseRecord) {
      if (courseRecord.name) {
        baseMetadata.courseName = courseRecord.name;
      }
      if (courseRecord.code) {
        baseMetadata.courseCode = courseRecord.code;
      }
    }

    if (assignmentRecord?.title) {
      baseMetadata.assignmentTitle = assignmentRecord.title;
    }

    if (problemRecord?.title) {
      baseMetadata.problemTitle = problemRecord.title;
    }

    if (submissionRecord) {
      if (submissionRecord.originalFileName) {
        baseMetadata.submissionOriginalFileName = submissionRecord.originalFileName;
      }
      if (submissionRecord.fileName) {
        baseMetadata.submissionFileName = submissionRecord.fileName;
      }
    }
  }

  try {
    await prisma.activityLog.create({
      data: {
        userId: safeUserId,
        action: data.action,
        category,
        courseId: data.courseId ?? null,
        assignmentId: data.assignmentId ?? null,
        problemId: data.problemId ?? null,
        submissionId: data.submissionId ?? null,
        ipAddress,
        userAgent,
        // Ensure a Prisma-compatible JSON value; default to empty object
        metadata: (baseMetadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      // Foreign key violation (e.g., race or another stale FK) — log and continue
      console.warn('[ActivityLog] FK violation skipped (P2003):', err.meta);
      return;
    }
    // Other errors should surface
    throw err;
  }
}

/**
 * Example usage patterns for the enhanced ActivityLog system
 */
export const ExampleUsage = {
  // Creating an activity log with the new structure
  createAssignmentPublishLog: `
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: 'UPDATE_ASSIGNMENT',
        category: 'ASSIGNMENT',
        courseId: assignment.courseId,
        assignmentId: assignment.id,
        ipAddress: getClientIp(req),
        userAgent: req.headers.get('user-agent'),
        metadata: {
          updatedFields: ['isPublished'],
          previousValue: false,
          newValue: true
        }
      }
    });
  `,

  // Querying course activities efficiently
  getCourseActivities: `
    const activities = await prisma.activityLog.findMany(
      ActivityLogQueries.forCourse('course123', 50)
    );
  `,

  // Complex filtering
  getRecentAssignmentChanges: `
    const changes = await prisma.activityLog.findMany({
      where: {
        category: 'ASSIGNMENT',
        action: { in: ['CREATE_ASSIGNMENT', 'UPDATE_ASSIGNMENT'] },
        timestamp: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      },
      include: { user: true, assignment: true, course: true }
    });
  `,
};
