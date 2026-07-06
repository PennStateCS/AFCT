import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { prisma } from '@/lib/prisma';

// GET - Fetch comments for a specific problem
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
                role: true,
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

// POST - Create a new comment for a specific problem
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

    // Find the user's roster entry for this course
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
        metadata: { role: session?.user?.role ?? null },
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
                role: true,
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
