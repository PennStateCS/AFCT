// /src/api/courses/[id]/archive/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Extract params
    const { id: courseId } = await context.params;

    // Parse JSON body
    const { startDate, endDate, isArchived } = await req.json();

    // Validate input
    if (typeof isArchived !== 'boolean') {
      return NextResponse.json({ error: 'isArchived must be a boolean' }, { status: 400 });
    }

    // Get authenticated user session
    const session = await auth();
    const user = session?.user;

    // Allow only ADMIN or FACULTY to toggle archive status
    if (!user || !['ADMIN', 'FACULTY'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Check if the course is in session
    const inSession = new Date(startDate) <= new Date() && new Date() <= new Date(endDate);

    // Check archiving conditions if archiniving
    if (isArchived && inSession) { // Note logic appears swapped for isArchived, but that is because isArchived is the next state
      // Get info to make sure no student submissions and no student grades exist
      const hasSubmission = await prisma.submission.findFirst({
        where: {
          assignmentProblem: {
            assignment: {
              courseId: courseId,
            },
          },
        },
        select: { id: true },
      });
      
      const hasGrade = await prisma.assignmentGrade.findFirst({
        where: {
          assignment: {
            courseId: courseId,
          },
        },
        select: { id: true },
      });

      const atLeastOneSubmission = !!hasSubmission;
      const atLeastOneGrade = !!hasGrade;

      if (atLeastOneSubmission) {
        return NextResponse.json({ error: 'Course must not have any submitted problems or not in session to archive' }, { status: 403 });
      }

      if (atLeastOneGrade) {
        console.log(atLeastOneGrade)
        return NextResponse.json({ error: 'Course must not have any graded assignments or not in session to archive' }, { status: 403 });
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
