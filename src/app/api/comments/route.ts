import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canAccessCourse, canManageCourse } from '@/lib/permissions';
import { apiError } from '@/lib/api/http';
import { logDenial, logError } from '@/lib/api/activity';

const createCommentSchema = z.object({
  content: z.string().min(1, 'Comment content is required').max(5000, 'Comment too long'),
  assignmentId: z.string(),
  problemId: z.string(),
  studentId: z.string().optional(), // the student this thread is about (optional)
});

/**
 * Creates a comment on an assignment problem, optionally scoped to a particular
 * student's thread (`studentId`). The author must be an enrolled member of the course
 * (any role) or a system admin; a system admin who isn't on the roster is auto-added
 * as FACULTY. Both the problem and any named student must belong to the course.
 * @openapi
 * summary: Create a comment
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [content, assignmentId, problemId]
 *         properties:
 *           content: { type: string, maxLength: 5000 }
 *           assignmentId: { type: string }
 *           problemId: { type: string }
 *           studentId: { type: string, description: The student this thread is about }
 * responses:
 *   201: { description: The created comment with its author. }
 *   400: { description: Validation failed. }
 *   401: { description: Not signed in. }
 *   403: { description: Author is not an enrolled member of the course or a system admin. }
 *   404: { description: "Assignment, problem, or named student not found." }
 *   500: { description: Server error. }
 */
export async function POST(request: NextRequest) {
  let actorId: string | null = null;
  try {
    const session = await auth();
    const user = session?.user;
    actorId = user?.id ?? null;
    if (!user || user.inactive) {
      return apiError(401, 'Unauthorized');
    }

    const body = await request.json();
    const { content, assignmentId, problemId, studentId } = createCommentSchema.parse(body);

    // Verify assignment & course
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { courseId: true, isPublished: true },
    });
    if (!assignment) {
      return apiError(404, 'Assignment not found');
    }

    // Authorize: any enrolled user (or admin) may comment.
    if (!(await canAccessCourse(user, assignment.courseId))) {
      return logDenial(request, {
        userId: user.id,
        action: 'COMMENT_CREATE_DENIED',
        courseId: assignment.courseId,
      });
    }

    const isStaff = await canManageCourse(user, assignment.courseId);

    // A student must not comment on an unpublished assignment (they can't see it);
    // only course staff may. Mask it as 404 so the assignment stays invisible.
    if (!assignment.isPublished && !isStaff) {
      // Existence-mask (404, not 403), so we log the denial directly rather than via
      // logDenial (which returns 403 Forbidden).
      await createEnhancedActivityLog(prisma, request, {
        userId: user.id,
        action: 'COMMENT_CREATE_DENIED',
        severity: 'SECURITY',
        courseId: assignment.courseId,
        metadata: { reason: 'unpublished assignment' },
      });
      return apiError(404, 'Assignment not found');
    }

    // Students may only comment on their own thread. `studentId` (aboutStudentId)
    // names whose feedback thread the comment belongs to; a non-staff author may
    // only target themselves. Staff/admin may file into any student's thread.
    if (studentId && studentId !== user.id && !isStaff) {
      return logDenial(request, {
        userId: user.id,
        action: 'COMMENT_CREATE_DENIED',
        courseId: assignment.courseId,
        metadata: { reason: "another student's thread" },
      });
    }

    // The author's roster row supplies only their course-role badge and may be absent
    // (e.g. a system admin commenting on a course they aren't enrolled in). We do NOT
    // fabricate a roster row — the comment is attributed to the author (User) directly.
    const rosterEntry = await prisma.roster.findFirst({
      where: { courseId: assignment.courseId, userId: user.id },
      select: { id: true },
    });

    // Verify problem belongs to course
    const problem = await prisma.problem.findFirst({
      where: { id: problemId, courseId: assignment.courseId },
    });
    if (!problem) {
      return apiError(404, 'Problem not found in this course');
    }

    // Verify the problem is actually linked to THIS assignment (not merely present
    // in the course) — otherwise a comment could be created against an
    // assignment/problem pair that doesn't exist.
    const link = await prisma.assignmentProblem.findUnique({
      where: { assignmentId_problemId: { assignmentId, problemId } },
      select: { assignmentId: true },
    });
    if (!link) {
      return apiError(400, 'Problem is not part of this assignment');
    }

    // If filtering by a specific student, verify they’re enrolled
    if (studentId) {
      const studentRosterEntry = await prisma.roster.findUnique({
        where: { courseId_userId: { courseId: assignment.courseId, userId: studentId } },
      });
      if (!studentRosterEntry) {
        return apiError(404, 'Student not enrolled in this course');
      }
    }

    // Create comment — attributed to the author (User); roster (role badge) optional.
    const comment = await prisma.comment.create({
      data: {
        content,
        assignmentId,
        problemId,
        authorId: user.id,
        rosterId: rosterEntry?.id ?? null,
        aboutStudentId: studentId || null,
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        roster: { select: { role: true } }, // course role for the badge, may be null
      },
    });

    await createEnhancedActivityLog(prisma, request, {
      userId: user.id,
      action: 'CREATE_COMMENT',
      severity: 'INFO',
      category: 'ASSIGNMENT',
      courseId: assignment.courseId,
      assignmentId,
      problemId,
      metadata: {
        userId: user.id,
        courseId: assignment.courseId,
        assignmentId: assignmentId,
        problemId: problemId,
        commentId: comment.id,
        aboutStudentId: studentId || null,
        contentLength: content.length,
      },
    });

    // IMPORTANT: include author.id (and role) so the client can right/left align immediately
    return NextResponse.json(
      {
        id: comment.id,
        content: comment.content,
        createdAt: comment.createdAt,
        author: {
          id: comment.author.id,
          firstName: comment.author.firstName ?? null,
          lastName: comment.author.lastName ?? null,
          avatar: comment.author.avatar ?? null,
          role: comment.roster?.role ?? null,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating comment:', error);
    await logError(request, { userId: actorId, action: 'COMMENT_CREATE_ERROR', error });
    if (error instanceof z.ZodError) {
      return apiError(400, 'Invalid request data');
    }
    return apiError(500, 'Internal server error');
  }
}

/**
 * Deletes a comment by id. Comments are immutable to students — **only course staff
 * (faculty or TAs) or a system admin may delete**, including deleting their own.
 * A student cannot delete a comment they authored.
 * @openapi
 * summary: Delete a comment
 * parameters:
 *   - { name: commentId, in: query, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Comment deleted. }
 *   400: { description: Missing commentId. }
 *   401: { description: Not signed in. }
 *   403: { description: Not course staff or a system admin. }
 *   404: { description: Comment not found. }
 *   500: { description: Server error. }
 */
export async function DELETE(request: NextRequest) {
  let actorId: string | null = null;
  try {
    const session = await auth();
    const user = session?.user;
    actorId = user?.id ?? null;
    if (!user || user.inactive) {
      return apiError(401, 'Unauthorized');
    }

    const { searchParams } = new URL(request.url);
    const commentId = searchParams.get('commentId');
    if (!commentId) {
      return apiError(400, 'commentId is required');
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        assignment: { select: { courseId: true } },
      },
    });
    if (!comment) {
      return apiError(404, 'Comment not found');
    }

    // Comments are immutable to students: only course staff (faculty/TA) or a system
    // admin may delete — including their own. A student cannot delete their comment.
    if (!(await canManageCourse(user, comment.assignment.courseId))) {
      return logDenial(request, {
        userId: user.id,
        action: 'COMMENT_DELETE_DENIED',
        courseId: comment.assignment.courseId,
      });
    }

    await prisma.comment.delete({ where: { id: commentId } });

    await createEnhancedActivityLog(prisma, request, {
      userId: user.id,
      action: 'DELETE_COMMENT',
      severity: 'INFO',
      category: 'ASSIGNMENT',
      courseId: comment.assignment.courseId,
      assignmentId: comment.assignmentId,
      problemId: comment.problemId,
      metadata: {
        userId: user.id,
        action: 'DELETE_COMMENT',
        category: 'ASSIGNMENT',
        courseId: comment.assignment.courseId,
        assignmentId: comment.assignmentId,
        problemId: comment.problemId,
        commentId: comment.id,
        aboutStudentId: comment.aboutStudentId,
        isOwnerDeleting: comment.authorId === user.id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting comment:', error);
    await logError(request, { userId: actorId, action: 'COMMENT_DELETE_ERROR', error });
    return apiError(500, 'Internal server error');
  }
}
