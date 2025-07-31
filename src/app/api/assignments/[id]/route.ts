import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Update assignment (PUT)
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
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
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Assignment update failed:', error);
    return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 });
  }
}

// Create assignment (POST)
export async function POST(req: NextRequest) {
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

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Assignment creation failed:', error);
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 });
  }
}
