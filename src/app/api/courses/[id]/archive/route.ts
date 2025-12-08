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

    // Make sure course is published and after end date or has no students
    const courseInfo = await prisma.course.findFirst({
      where: { id: courseId },
      select: {
        isPublished: true,
        endDate: true,
        _count: { select: { roster: { where: { role: "STUDENT" } } } }
      }
    })

    // Set variables for checking
    const studentCount = courseInfo?._count?.roster ?? 0;
    const hasStudents = studentCount > 0;

    // Check archiving conditions if archiniving
    if (isArchived) {
      if (hasStudents && !courseInfo?.isPublished ) {
        return NextResponse.json({ error: 'Active course must be published before archiving' }, { status: 403 });
      }

      if (hasStudents && courseInfo?.endDate && courseInfo?.endDate >= new Date()) {
        return NextResponse.json({ error: 'Active course must have ended before archiving' }, { status: 403 });
      }
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
        userId: user.id,
        courseId: courseId,
        courseName: updated.name,
        isArchived: isArchived,
      },
    });

    // Respond with the updated course
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed PATCH /api/courses/[id]/archive error:', error);
    return NextResponse.json('Failed to update archive status', { status: 500 });
  }
}
