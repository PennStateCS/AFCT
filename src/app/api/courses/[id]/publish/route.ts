import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { isPublished } = await req.json();

    if (typeof isPublished !== 'boolean') {
      return NextResponse.json({ error: 'isPublished must be a boolean' }, { status: 400 });
    }

    const updated = await prisma.course.update({
      where: { id },
      data: { isPublished },
      select: {
        id: true,
        name: true,
        code: true,
        isPublished: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/courses/[id]/publish error:', error);
    return new NextResponse('Failed to update publish status', { status: 500 });
  }
}
