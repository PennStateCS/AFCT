// /src/app/api/assignments

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function POST(req: NextRequest) {
  try {
    // Retrieve the current authenticated session
    const session = await auth();

    // Ensure user is authenticated and has the correct role
    if (!session || !['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Parse incoming request data
    const data = await req.json();

    // Validate required fields
    if (!data.title || !data.courseId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Create a new assignment in the database
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

    // Log the creation action to ActivityLog
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'CREATE_ASSIGNMENT',
      category: 'ASSIGNMENT',
      courseId: created.courseId,
      assignmentId: created.id,
      metadata: {
        title: created.title,
        description: created.description ? 'Has description' : 'No description',
        maxPoints: created.maxPoints,
        isPublished: created.isPublished,
        dueDate: created.dueDate.toISOString(),
      },
    });

    // Respond with the newly created assignment
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    // Log error to the server console
    console.error('Assignment creation failed:', error);
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 });
  }
}
