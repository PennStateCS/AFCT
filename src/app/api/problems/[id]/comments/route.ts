import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { prisma } from '@/lib/prisma';
import { canAccessCourse } from '@/lib/permissions';

/**
 * Fetches comments for a problem. Any signed-in user may call it. Note the problem
 * is identified by the `?problemId` query parameter — the `[id]` path segment is
 * ignored. An optional `studentId` narrows to comments about, or authored by, that
 * student.
 * @openapi
 * summary: List comments for a problem
 * parameters:
 *   - { name: id, in: path, required: true, description: Ignored; problemId comes from the query, schema: { type: string } }
 *   - { name: problemId, in: query, required: true, schema: { type: string } }
 *   - { name: studentId, in: query, description: Narrow to a student's thread, schema: { type: string } }
 * responses:
 *   200:
 *     description: The problem's comments, oldest first.
 *     content:
 *       application/json:
 *         schema: { type: array, items: { type: object } }
 *   400: { description: Missing problemId. }
 *   401: { description: Not signed in. }
 *   500: { description: Server error. }
 */
export async function GET(request: NextRequest, { params: _params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const problemId = searchParams.get('problemId');
    const studentId = searchParams.get('studentId');

    // Throw error if problem id does not exist
    if (!problemId) {
      return NextResponse.json(
        { error: 'assignmentId and problemId are required' },
        { status: 400 },
      );
    }

    // If studentId present, restrict to comments about that student OR authored by that student
    const whereClause = studentId
      ? {
          problemId,
          OR: [{ aboutStudentId: studentId }, { roster: { userId: studentId } }],
        }
      : { problemId };

    // Fetch comments for the problem
    const comments = await prisma.comment.findMany({
      where: whereClause,
      include: {
        roster: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Transform comments to match the expected format
    const transformedComments = comments.map((comment: (typeof comments)[number]) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
      authorId: comment.roster.userId,
      authorName:
        `${comment.roster.user.firstName || ''} ${comment.roster.user.lastName || ''}`.trim() ||
        'Unknown User',
      authorRole: comment.roster.role,
      problemId: comment.problemId,
    }));

    return NextResponse.json(transformedComments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
  }
}

/**
 * Posts a comment on a problem (identified by the `[id]` path segment here). The
 * author must be enrolled in the problem's course; the comment is attached to the
 * problem's first linked assignment.
 * @openapi
 * summary: Add a comment to a problem
 * parameters:
 *   - { name: id, in: path, required: true, description: Problem id, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema: { type: object, required: [content], properties: { content: { type: string } } }
 * responses:
 *   201: { description: The created comment. }
 *   400: { description: Empty content. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller is not enrolled in the course. }
 *   404: { description: Problem or its assignment not found. }
 *   500: { description: Server error. }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let actorId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    actorId = session.user.id;

    const resolvedParams = await params;
    const problemId = resolvedParams.id;
    const { content } = await request.json();

    if (!content || content.trim().length === 0) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 });
    }

    // Get the problem to find the assignment
    const problem = await prisma.problem.findUnique({
      where: { id: problemId },
      include: {
        assignments: {
          include: {
            assignment: {
              include: {
                course: true,
              },
            },
          },
        },
      },
    });

    if (!problem || problem.assignments.length === 0) {
      return NextResponse.json({ error: 'Problem or assignment not found' }, { status: 404 });
    }

    const assignmentProblem = problem.assignments[0];
    const assignment = assignmentProblem.assignment;

    // Authorize: any enrolled user (or admin) may comment.
    if (!(await canAccessCourse(session.user, assignment.course.id))) {
      await createEnhancedActivityLog(prisma, request, {
        userId: session?.user?.id ?? null,
        action: 'COMMENT_CREATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'User not enrolled in this course' }, { status: 403 });
    }

    // Obtain the author's roster row for the comment FK.
    const rosterEntry = await prisma.roster.findFirst({
      where: {
        userId: session.user.id,
        courseId: assignment.course.id,
      },
    });

    if (!rosterEntry) {
      await createEnhancedActivityLog(prisma, request, {
        userId: session?.user?.id ?? null,
        action: 'COMMENT_CREATE_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'User not enrolled in this course' }, { status: 403 });
    }

    // Create the comment
    const comment = await prisma.comment.create({
      data: {
        content: content.trim(),
        assignmentId: assignment.id,
        problemId: problemId,
        rosterId: rosterEntry.id,
      },
      include: {
        roster: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    await createEnhancedActivityLog(prisma, request, {
      userId: session.user.id,
      action: 'CREATE_COMMENT',
      severity: 'INFO',
      category: 'ASSIGNMENT',
      courseId: assignment.course.id,
      assignmentId: assignment.id,
      problemId: problemId,
      metadata: {
        userId: session.user.id,
        courseId: assignment.course.id,
        assignmentId: assignment.id,
        problemId: problemId,
        commentId: comment.id,
        contentLength: content.trim().length,
      },
    });

    // Transform comment to match the expected format
    const transformedComment = {
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
      authorName:
        `${comment.roster.user.firstName || ''} ${comment.roster.user.lastName || ''}`.trim() ||
        'Unknown User',
      authorRole: comment.roster.role,
      problemId: comment.problemId,
    };

    return NextResponse.json(transformedComment, { status: 201 });
  } catch (error) {
    console.error('Error creating comment:', error);
    await createEnhancedActivityLog(prisma, request, {
      userId: actorId,
      action: 'COMMENT_CREATE_ERROR',
      severity: 'ERROR',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 });
  }
}
