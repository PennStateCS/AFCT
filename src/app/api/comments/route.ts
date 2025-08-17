import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

const createCommentSchema = z.object({
  content: z.string().min(1, 'Comment content is required'),
  assignmentId: z.string(),
  problemId: z.string(),
  studentId: z.string().optional(), // ID of the student whose work this comment is about
});

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const session = await auth();
    const user = session?.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate request body
    const body = await request.json();
    const { content, assignmentId, problemId, studentId } = createCommentSchema.parse(body);

    // Get the course ID from the assignment to find the user's roster entry
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { courseId: true },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Find the user's roster entry for this course
    const rosterEntry = await prisma.roster.findUnique({
      where: {
        courseId_userId: {
          courseId: assignment.courseId,
          userId: user.id,
        },
      },
    });

    if (!rosterEntry) {
      return NextResponse.json({ error: 'User not enrolled in this course' }, { status: 403 });
    }

    // Verify the problem exists and belongs to the same course
    const problem = await prisma.problem.findFirst({
      where: {
        id: problemId,
        courseId: assignment.courseId,
      },
    });

    if (!problem) {
      return NextResponse.json({ error: 'Problem not found in this course' }, { status: 404 });
    }

    // If studentId is provided, verify the student is enrolled in the course
    if (studentId) {
      const studentRosterEntry = await prisma.roster.findUnique({
        where: {
          courseId_userId: {
            courseId: assignment.courseId,
            userId: studentId,
          },
        },
      });

      if (!studentRosterEntry) {
        return NextResponse.json({ error: 'Student not enrolled in this course' }, { status: 404 });
      }
    }

    // Create the comment
    const comment = await prisma.comment.create({
      data: {
        content,
        assignmentId,
        problemId,
        rosterId: rosterEntry.id,
        aboutStudentId: studentId || null,
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

    return NextResponse.json({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      author: {
        firstName: comment.roster?.user?.firstName || null,
        lastName: comment.roster?.user?.lastName || null,
      },
    });
  } catch (error) {
    console.error('Error creating comment:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.issues },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const session = await auth();
    const user = session?.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const assignmentId = searchParams.get('assignmentId');
    const problemId = searchParams.get('problemId');
    const studentId = searchParams.get('studentId');

    if (!assignmentId || !problemId) {
      return NextResponse.json(
        { error: 'assignmentId and problemId are required' },
        { status: 400 },
      );
    }

    // Get the assignment to verify course access
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { courseId: true },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Verify user has access to this course
    const rosterEntry = await prisma.roster.findUnique({
      where: {
        courseId_userId: {
          courseId: assignment.courseId,
          userId: user.id,
        },
      },
    });

    if (!rosterEntry) {
      return NextResponse.json({ error: 'User not enrolled in this course' }, { status: 403 });
    }

    // Build where clause for comments
    const whereClause = {
      assignmentId,
      problemId,
      ...(studentId && { aboutStudentId: studentId }),
    };

    // Get comments for this assignment and problem (and optionally student)
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

    const formattedComments = comments.map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      author: {
        firstName: comment.roster.user.firstName,
        lastName: comment.roster.user.lastName,
      },
    }));

    return NextResponse.json(formattedComments);
  } catch (error) {
    console.error('Error fetching comments:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Verify authentication
    const session = await auth();
    const user = session?.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get comment ID from query parameters
    const { searchParams } = new URL(request.url);
    const commentId = searchParams.get('commentId');

    if (!commentId) {
      return NextResponse.json({ error: 'commentId is required' }, { status: 400 });
    }

    // Find the comment and verify ownership or permissions
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        roster: {
          include: {
            user: true,
          },
        },
        assignment: {
          select: {
            courseId: true,
          },
        },
      },
    });

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    // Check if user can delete this comment
    // Users can delete their own comments, or faculty/admins can delete any comments in their courses
    const isOwner = comment.roster.user.id === user.id;
    const isAuthorized = isOwner || ['ADMIN', 'FACULTY'].includes(user.role);

    if (!isAuthorized) {
      // If not owner or admin/faculty, check if they're faculty/TA in this course
      const userRosterEntry = await prisma.roster.findUnique({
        where: {
          courseId_userId: {
            courseId: comment.assignment.courseId,
            userId: user.id,
          },
        },
      });

      if (!userRosterEntry || userRosterEntry.role === 'STUDENT') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Delete the comment
    await prisma.comment.delete({
      where: { id: commentId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting comment:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
