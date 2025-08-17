// /src/app/api/assignments/[id]

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

// Update an existing assignment
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

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';

    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: 'UPDATE_ASSIGNMENT',
        metadata: {
          assignmentId: id,
          ipAddress: ip,
        },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Assignment update failed:', error);
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

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';

    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: 'CREATE_ASSIGNMENT',
        metadata: {
          assignmentId: created.id,
          courseId: created.courseId,
          ipAddress: ip,
        },
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Assignment creation failed:', error);
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 });
  }
}
