// /src/api/courses/[id]/archive/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // Extract course ID from route params
    const { id: courseId } = await context.params;

    // Parse JSON body
    const { isArchived } = await req.json();

    // Validate input
    if (typeof isArchived !== 'boolean') {
      return NextResponse.json({ error: 'isArchived must be a boolean' }, { status: 400 });
    }

    // Get authenticated user session
    const session = await auth();
    const user = session?.user;

    // Allow only ADMIN, FACULTY, or TA to toggle archive status
    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Update course archive status
    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { isArchived },
      select: {
        id: true,
        name: true,
        code: true,
        isArchived: true,
        updatedAt: true,
      },
    });

    // Log the archive/notArchived event
    await createEnhancedActivityLog(prisma, req, {
      userId: user.id,
      action: isArchived ? 'COURSE_ARCHIVED' : 'COURSE_NOT_ARCHIVED',
      category: 'COURSE',
      courseId,
      metadata: {
        courseName: updated.name,
        isArchived,
      },
    });

    // Respond with the updated course
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH /api/courses/[id]/archive error:', error);
    return new NextResponse('Failed to update archive status', { status: 500 });
  }
}
