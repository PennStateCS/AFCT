// /src/app/api/assignments/[id]

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

// Get a single assignment by ID
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const assignment = await prisma.assignment.findUnique({
      where: { id },
      include: {
        course: true,
        problems: {
          include: {
            problem: true
          }
        }
      }
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    // Check permissions - students can only see published assignments in courses they're enrolled in
    if (session.user.role === 'STUDENT') {
      // Check if assignment is published
      if (!assignment.isPublished) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }

      // Check if student is enrolled in the course
      const enrollment = await prisma.roster.findFirst({
        where: {
          courseId: assignment.courseId,
          userId: session.user.id
        }
      });

      if (!enrollment) {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }
    }

    // For non-students, check if they have access to the course
    if (!['ADMIN'].includes(session.user.role)) {
      const hasAccess = await prisma.roster.findFirst({
        where: {
          courseId: assignment.courseId,
          userId: session.user.id,
          role: { in: ['FACULTY', 'TA'] }
        }
      });

      if (!hasAccess && session.user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
      }
    }

    return NextResponse.json(assignment);
  } catch (error) {
    console.error('Failed to fetch assignment:', error);
    return NextResponse.json({ error: 'Failed to fetch assignment' }, { status: 500 });
  }
}

// Update an existing assignment (full update)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();

  if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const data = await req.json();

  try {
    const updated = await prisma.assignment.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        dueDate: new Date(data.dueDate),
        maxPoints: data.maxPoints,
        isPublished: data.isPublished,
      },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'UPDATE_ASSIGNMENT',
      category: 'ASSIGNMENT',
      courseId: updated.courseId,
      assignmentId: id,
      metadata: {
        updatedFields: Object.keys(data),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Assignment update failed:', error);
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
  }
}

// Partial update of an assignment (PATCH)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const session = await auth();

  if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const data = await req.json();

  try {
    // Build update data object with only provided fields
    const updateData: {
      title?: string;
      description?: string;
      dueDate?: Date;
      maxPoints?: number;
      isPublished?: boolean;
    } = {};
    
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.dueDate !== undefined) updateData.dueDate = new Date(data.dueDate);
    if (data.maxPoints !== undefined) updateData.maxPoints = data.maxPoints;
    if (data.isPublished !== undefined) updateData.isPublished = data.isPublished;

    const updated = await prisma.assignment.update({
      where: { id },
      data: updateData,
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'UPDATE_ASSIGNMENT',
      category: 'ASSIGNMENT',
      courseId: updated.courseId,
      assignmentId: id,
      metadata: {
        updatedFields: Object.keys(updateData),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Assignment partial update failed:', error);
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
  }
}

// Create a new assignment (POST /api/assignments/[id])
export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const data = await req.json();

    if (!data.title || !data.courseId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const created = await prisma.assignment.create({
      data: {
        title: data.title,
        description: data.description,
        dueDate: new Date(data.dueDate),
        maxPoints: data.maxPoints || 0,
        isPublished: data.isPublished || false,
        courseId: data.courseId,
      },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'CREATE_ASSIGNMENT',
      category: 'ASSIGNMENT',
      courseId: created.courseId,
      assignmentId: created.id,
      metadata: {
        title: created.title,
        maxPoints: created.maxPoints,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Assignment creation failed:', error);
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 });
  }
}
