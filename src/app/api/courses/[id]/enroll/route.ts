// /src/api/courses/[id]/enroll/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

// POST: Enroll a user into a course using their global role
// Expects: { userId: string }
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params;
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
    return NextResponse.json({ error: 'User is inactive'}, { status: 401 })
  }

  try {
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
    const session = await auth();
    const actingUser = session?.user;

    await createEnhancedActivityLog(prisma, req, {
      userId: actingUser?.id,
      action: 'ENROLL_USER',
      category: 'COURSE',
      courseId,
      metadata: {
        userId: actingUser?.id,
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
    return NextResponse.json({ error: 'Failed to enroll user' }, { status: 500 });
  }
}
