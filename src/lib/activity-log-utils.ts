/**
 * Utility functions for enhanced ActivityLog system
 * Note: This requires the enhanced ActivityLog schema with foreign keys
 */

import { getClientIp } from './ip-utils';

export type ActivityCategory = 
  | 'SYSTEM'      // Login, logout, session extend
  | 'USER'        // User CRUD, password changes  
  | 'COURSE'      // Course CRUD, enrollment
  | 'ASSIGNMENT'  // Assignment CRUD, publishing
  | 'PROBLEM'     // Problem CRUD
  | 'SUBMISSION'; // Submission CRUD, grading

export interface EnhancedActivityLogData {
  userId?: string;
  action: string;
  category?: ActivityCategory;
  courseId?: string;
  assignmentId?: string;
  problemId?: string;
  submissionId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Determines the activity category from the action string
 */
export function getActivityCategory(action: string): ActivityCategory {
  const upperAction = action.toUpperCase();
  
  if (upperAction.includes('LOGIN') || upperAction.includes('LOGOUT') || upperAction.includes('SESSION')) {
    return 'SYSTEM';
  }
  if (upperAction.includes('USER') || upperAction.includes('PASSWORD') || upperAction.includes('PROFILE')) {
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
 * These will work once the schema migration is complete and Prisma client is regenerated
 */
export const ActivityLogQueries = {
  // Get all activities for a course
  forCourse: (courseId: string, limit = 50) => ({
    where: { courseId },
    include: { 
      user: { select: { firstName: true, lastName: true, email: true, avatar: true } },
      course: { select: { name: true, code: true } }
    },
    orderBy: { timestamp: 'desc' as const },
    take: limit,
  }),

  // Get activities for an assignment
  forAssignment: (assignmentId: string, limit = 50) => ({
    where: { assignmentId },
    include: { 
      user: { select: { firstName: true, lastName: true, email: true, avatar: true } },
      assignment: { select: { title: true } }
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
      problem: { select: { title: true } }
    },
    orderBy: { timestamp: 'desc' as const },
    take: limit,
  }),

  // Get activities by category
  byCategory: (category: ActivityCategory, limit = 50) => ({
    where: { category },
    include: { 
      user: { select: { firstName: true, lastName: true, email: true, avatar: true } }
    },
    orderBy: { timestamp: 'desc' as const },
    take: limit,
  }),

  // Get recent system activities (logins, etc.)
  systemActivities: (limit = 100) => ({
    where: { category: 'SYSTEM' },
    include: { 
      user: { select: { firstName: true, lastName: true, email: true, avatar: true } }
    },
    orderBy: { timestamp: 'desc' as const },
    take: limit,
  }),

  // Get activities with date range
  inDateRange: (startDate: Date, endDate: Date, filters?: { courseId?: string; category?: ActivityCategory }) => ({
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
      problem: { select: { title: true } }
    },
    orderBy: { timestamp: 'desc' as const },
  }),
};

/**
 * Enhanced activity log creation helper
 * Automatically extracts IP address and categorizes the activity
 */
export async function createEnhancedActivityLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  req: Request,
  data: EnhancedActivityLogData
): Promise<void> {
  const category = data.category || getActivityCategory(data.action);
  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || undefined;
  
  await prisma.activityLog.create({
    data: {
      userId: data.userId,
      action: data.action,
      category,
      courseId: data.courseId,
      assignmentId: data.assignmentId,
      problemId: data.problemId,
      submissionId: data.submissionId,
      ipAddress,
      userAgent,
      metadata: data.metadata,
    }
  });
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
  `
};
