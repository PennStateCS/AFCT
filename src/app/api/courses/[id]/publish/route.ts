// /src/app/api/courses/[id]/publish/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // Extract course ID from route params
    const { id: courseId } = await context.params;

    // Parse JSON body
    const { isPublished } = await req.json();

    // Validate input
    if (typeof isPublished !== 'boolean') {
      return NextResponse.json({ error: 'isPublished must be a boolean' }, { status: 400 });
    }

    // Get authenticated user session
    const session = await getServerSession(authOptions);
    const user = session?.user;

    // Allow only ADMIN, FACULTY, or TA to toggle publish status
    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Update course publish status
    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { isPublished },
      select: {
        id: true,
        name: true,
        code: true,
        isPublished: true,
        updatedAt: true,
      },
    });

    // Log the publish/unpublish event
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: isPublished ? 'COURSE_PUBLISHED' : 'COURSE_UNPUBLISHED',
        metadata: {
          courseId,
          courseName: updated.name,
          isPublished,
          ipAddress: ip,
          userAgent,
        },
      },
    });

    // Respond with the updated course
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/courses/[id]/publish error:', error);
    return new NextResponse('Failed to update publish status', { status: 500 });
  }
}
