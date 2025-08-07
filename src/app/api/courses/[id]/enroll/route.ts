// /src/api/courses/[id]/enroll/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

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
    select: { id: true, role: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  try {
    // Upsert the user into the course roster
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
        role: user.role, // Assign the user’s global role to the course
      },
      update: {
        role: user.role, // Update the course role if it changed globally
      },
    });

    // Log enrollment to the ActivityLog
    const session = await getServerSession(authOptions);
    const actingUser = session?.user;

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    await prisma.activityLog.create({
      data: {
        userId: actingUser?.id ?? 'system',
        action: 'ENROLL_USER',
        metadata: {
          enrolledUserId: userId,
          courseId,
          role: user.role,
          ipAddress: ip,
          userAgent,
        },
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
