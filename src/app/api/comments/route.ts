import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { RoleEnum, CourseRoleEnum } from '@/schemas/user';

// ---- Types ----
interface CommentUser {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  avatar?: string | null;
  role?: z.infer<typeof RoleEnum> | null;
}

interface CommentRoster {
  role?: z.infer<typeof CourseRoleEnum> | null;
  user: CommentUser;
}

interface CommentDB {
  id: string;
  content: string;
  createdAt: string | Date;
  roster: CommentRoster;
  assignmentId?: string;
  problemId?: string;
  aboutStudentId?: string | null;
}

interface CommentResponse {
  id: string;
  content: string;
  createdAt: string | Date;
  problemId?: string;
  author: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    avatar: string | null;
    role: string | null;
  };
}

const createCommentSchema = z.object({
  content: z.string().min(1, 'Comment content is required').max(5000, 'Comment too long'),
  assignmentId: z.string(),
  problemId: z.string(),
  studentId: z.string().optional(), // the student this thread is about (optional)
});

/**
 * Creates a comment on an assignment problem, optionally scoped to a particular
 * student's thread (`studentId`). The author must be enrolled in the course; an
 * ADMIN who isn't is auto-added as an instructor. Both the problem and any named
 * student must belong to the course.
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
 *   403: { description: Author is not enrolled in the course. }
 *   404: { description: Assignment, problem, or named student not found. }
 *   500: { description: Server error. }
 */
export async function POST(request: NextRequest) {
  let actorId: string | null = null;
  try {
    const session = await auth();
    const user = session?.user;
    actorId = user?.id ?? null;
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { content, assignmentId, problemId, studentId } = createCommentSchema.parse(body);

    // Verify assignment & course
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { courseId: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Verify author is in this course (admins can be added automatically)
    let rosterEntry = await prisma.roster.findUnique({
      where: { courseId_userId: { courseId: assignment.courseId, userId: user.id } },
    });
    if (!rosterEntry) {
      if (user.role === 'ADMIN') {
        rosterEntry = await prisma.roster.create({
          data: {
            courseId: assignment.courseId,
            userId: user.id,
            role: 'INSTRUCTOR',
          },
        });
      } else {
        await createEnhancedActivityLog(prisma, request, {
          userId: session?.user?.id ?? null,
          action: 'COMMENT_CREATE_DENIED',
          severity: 'SECURITY',
          metadata: { role: session?.user?.role ?? null },
        });
        return NextResponse.json({ error: 'User not enrolled in this course' }, { status: 403 });
      }
    }

    // Verify problem belongs to course
    const problem = await prisma.problem.findFirst({
      where: { id: problemId, courseId: assignment.courseId },
    });
    if (!problem) {
      return NextResponse.json({ error: 'Problem not found in this course' }, { status: 404 });
    }

    // If filtering by a specific student, verify they’re enrolled
    if (studentId) {
      const studentRosterEntry = await prisma.roster.findUnique({
        where: { courseId_userId: { courseId: assignment.courseId, userId: studentId } },
      });
      if (!studentRosterEntry) {
        return NextResponse.json({ error: 'Student not enrolled in this course' }, { status: 404 });
      }
    }

    // Create comment
    const comment = (await prisma.comment.create({
      data: {
        content,
        assignmentId,
        problemId,
        rosterId: rosterEntry.id,
        aboutStudentId: studentId || null,
      },
      include: {
        roster: {
          select: {
            role: true, // course-specific role (e.g., FACULTY/TA/STUDENT)
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
                role: true, // global role if you want it too
              },
            },
          },
        },
      },
    })) as CommentDB;

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
          id: comment.roster.user.id,
          firstName: comment.roster.user.firstName ?? null,
          lastName: comment.roster.user.lastName ?? null,
          avatar: comment.roster.user.avatar ?? null,
          // prefer course role (FACULTY/TA/STUDENT); fall back to global
          role: comment.roster.role ?? comment.roster.user.role ?? null,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Error creating comment:', error);
    await createEnhancedActivityLog(prisma, request, {
      userId: actorId,
      action: 'COMMENT_CREATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Lists comments for an assignment problem, or for a whole assignment when
 * `scope=assignment`. Enrolled users (and admins) may read; an optional `studentId`
 * narrows to a single student's thread.
 * @openapi
 * summary: List comments
 * parameters:
 *   - { name: assignmentId, in: query, required: true, schema: { type: string } }
 *   - { name: problemId, in: query, description: Required unless scope=assignment, schema: { type: string } }
 *   - { name: scope, in: query, description: Set to "assignment" to list across the whole assignment, schema: { type: string, enum: [assignment] } }
 *   - { name: studentId, in: query, description: Narrow to a student's thread, schema: { type: string } }
 * responses:
 *   200:
 *     description: The matching comments, oldest first.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   400: { description: Missing assignmentId (or problemId when not in assignment scope). }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not enrolled in the course. }
 *   404: { description: Assignment not found. }
 *   500: { description: Server error. }
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const user = session?.user;
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const assignmentId = searchParams.get('assignmentId');
    const problemId = searchParams.get('problemId');
    const studentId = searchParams.get('studentId');
    const scope = searchParams.get('scope');
    const isAssignmentScope = scope === 'assignment';

    if (!assignmentId || (!problemId && !isAssignmentScope)) {
      return NextResponse.json(
        { error: 'assignmentId and problemId are required' },
        { status: 400 },
      );
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { courseId: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Verify caller access: enrolled users can read; global admins can always read.
    if (user.role !== 'ADMIN') {
      const rosterEntry = await prisma.roster.findUnique({
        where: { courseId_userId: { courseId: assignment.courseId, userId: user.id } },
      });
      if (!rosterEntry) {
        await createEnhancedActivityLog(prisma, request, {
          userId: session?.user?.id ?? null,
          action: 'COMMENT_VIEW_DENIED',
          severity: 'SECURITY',
          metadata: { role: session?.user?.role ?? null },
        });
        return NextResponse.json({ error: 'User not enrolled in this course' }, { status: 403 });
      }
    }

    // If studentId present, restrict to comments about that student OR authored by that student
    let whereClause: Prisma.CommentWhereInput;
    if (isAssignmentScope) {
      whereClause = studentId
        ? {
            assignmentId,
            OR: [{ aboutStudentId: studentId }, { roster: { userId: studentId } }],
          }
        : { assignmentId };
    } else {
      const requiredProblemId = problemId as string;
      whereClause = studentId
        ? {
            assignmentId,
            problemId: requiredProblemId,
            OR: [{ aboutStudentId: studentId }, { roster: { userId: studentId } }],
          }
        : { assignmentId, problemId: requiredProblemId };
    }

    const comments = (await prisma.comment.findMany({
      where: whereClause,
      include: {
        roster: {
          select: {
            role: true, // course role
            user: {
              select: {
                id: true, // needed for right/left alignment on client
                firstName: true,
                lastName: true,
                avatar: true,
                role: true, // global role (optional)
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })) as unknown as CommentDB[];

    const formatted: CommentResponse[] = comments.map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      problemId: c.problemId,
      author: {
        id: c.roster.user.id,
        firstName: c.roster.user.firstName,
        lastName: c.roster.user.lastName,
        avatar: c.roster.user.avatar ?? null,
        role: c.roster.role ?? c.roster.user.role ?? null,
      },
    })) as CommentResponse[];

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Error fetching comments:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Deletes a comment by id. The comment's author may delete their own; otherwise
 * only ADMIN/FACULTY, or a non-student course member, may remove it.
 * @openapi
 * summary: Delete a comment
 * parameters:
 *   - { name: commentId, in: query, required: true, schema: { type: string } }
 * responses:
 *   200: { description: Comment deleted. }
 *   400: { description: Missing commentId. }
 *   401: { description: Not signed in. }
 *   403: { description: Not allowed to delete this comment. }
 *   404: { description: Comment not found. }
 *   500: { description: Server error. }
 */
export async function DELETE(request: NextRequest) {
  let actorId: string | null = null;
  try {
    const session = await auth();
    const user = session?.user;
    actorId = user?.id ?? null;
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const commentId = searchParams.get('commentId');
    if (!commentId) {
      return NextResponse.json({ error: 'commentId is required' }, { status: 400 });
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        roster: { include: { user: true } },
        assignment: { select: { courseId: true } },
      },
    });
    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    // Owner or ADMIN/FACULTY can delete; otherwise check course role via roster
    const isOwner = comment.roster.user.id === user.id;
    const isAdminFaculty = ['ADMIN', 'FACULTY'].includes(user.role as string);
    if (!isOwner && !isAdminFaculty) {
      const userRosterEntry = await prisma.roster.findUnique({
        where: {
          courseId_userId: { courseId: comment.assignment.courseId, userId: user.id },
        },
      });
      if (!userRosterEntry || userRosterEntry.role === 'STUDENT') {
        await createEnhancedActivityLog(prisma, request, {
          userId: session?.user?.id ?? null,
          action: 'COMMENT_DELETE_DENIED',
          severity: 'SECURITY',
          metadata: { role: session?.user?.role ?? null },
        });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
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
        isOwnerDeleting: comment.roster.user.id === user.id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting comment:', error);
    await createEnhancedActivityLog(prisma, request, {
      userId: actorId,
      action: 'COMMENT_DELETE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
