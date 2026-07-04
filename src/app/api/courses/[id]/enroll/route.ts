// /src/api/courses/[id]/enroll/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

// POST: Enroll a user into a course using their global role
// Expects: { userId: string }
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params;
  let actorId: string | null = null;

  try {
    // Only faculty/admin/ta may edit the course roster.
    const session = await auth();
    actorId = session?.user?.id ?? null;
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!['ADMIN', 'FACULTY', 'TA'].includes(session.user.role)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'COURSE_ENROLL_DENIED',
        severity: 'SECURITY',
        courseId,
        metadata: { role: session.user.role ?? null },
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { userId } = await req.json();

    // Validate required field
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    // Look up the user and retrieve their global role
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, inactive: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.inactive == true) {
      return NextResponse.json({ error: 'User is inactive' }, { status: 401 });
    }

    // Map global role to course role
    const mapRole = (r: string | null | undefined) => {
        switch (r) {
        case 'FACULTY':
        case 'ADMIN':
          return 'FACULTY';
        case 'TA':
          return 'TA';
        default:
          return 'STUDENT';
      }
    };

    // Upsert the user into the course roster inheriting their global role
    const roleToAssign = mapRole(user.role);

    await prisma.roster.upsert({
      where: {
        courseId_userId: {
          courseId,
          userId,
        },
      },
      create: {
        courseId,
        userId,
        role: roleToAssign,
      },
      update: {
        role: roleToAssign,
      },
    });

    // Log enrollment to the ActivityLog
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'ENROLL_USER',
      severity: 'INFO',
      category: 'COURSE',
      courseId,
      metadata: {
        userId: actorId,
        courseId: courseId,
        enrolledUserId: userId,
        role: roleToAssign,
      },
    });

    // Return success response
    return NextResponse.json({ success: true });
  } catch (error) {
    // Catch and log any unexpected errors
    console.error('Enrollment error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'COURSE_ENROLL_ERROR',
      severity: 'ERROR',
      courseId,
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to enroll user' }, { status: 500 });
  }
}
