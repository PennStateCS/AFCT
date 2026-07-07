import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

/**
 * Adds (or re-roles) a single user on a course roster. Staff only
 * (ADMIN/FACULTY/TA). The course role is derived from the target's global role —
 * admins/faculty become FACULTY, TAs stay TA, everyone else STUDENT — so callers
 * don't pick the role directly. Upserts, so re-enrolling just refreshes the role.
 * @openapi
 * summary: Enroll a user in a course
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [userId]
 *         properties:
 *           userId: { type: string }
 * responses:
 *   200:
 *     description: Enrolled.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean } } }
 *   400: { description: Missing userId. }
 *   401: { description: "Not signed in, or the target user is inactive." }
 *   403: { description: Caller lacks a staff role. }
 *   404: { description: Target user not found. }
 *   500: { description: Server error. }
 */
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
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

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

    return NextResponse.json({ success: true });
  } catch (error) {
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
