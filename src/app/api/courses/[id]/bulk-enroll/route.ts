import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { canManageCourse } from '@/lib/permissions';
import type { Prisma } from '@prisma/client';

/**
 * Enrolls many users as STUDENT in one transaction (the roster's bulk-add flow).
 * Staff only (ADMIN/FACULTY/TA). Existing roster entries are reset to STUDENT
 * rather than duplicated, so it's safe to re-run. Unlike single enroll, every user
 * is added as a student regardless of their global role.
 * @openapi
 * summary: Bulk-enroll students
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [userIds]
 *         properties:
 *           userIds: { type: array, items: { type: string } }
 * responses:
 *   200:
 *     description: Enrolled; returns how many.
 *     content:
 *       application/json:
 *         schema: { type: object, properties: { success: { type: boolean }, enrolled: { type: integer } } }
 *   400: { description: No users provided. }
 *   401: { description: Not signed in. }
 *   403: { description: Caller lacks a staff role. }
 *   500: { description: Server error. }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await params;
  const courseId = resolved.id;
  let actorId: string | null = null;

  try {
    const session = await auth();
    actorId = session?.user?.id ?? null;
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Only faculty/admin/ta can bulk enroll
    if (!(await canManageCourse(session.user, courseId))) {
      await createEnhancedActivityLog(prisma, req as unknown as Request, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_BULK_ENROLL_DENIED',
        severity: 'SECURITY',
        metadata: {},
      });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const userIds: string[] = (body?.userIds ?? []).map((s: string) => String(s)).filter(Boolean);
    if (!userIds.length)
      return NextResponse.json({ message: 'No users provided' }, { status: 400 });

    // Enroll all users in a transaction as STUDENT course role.
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const uid of userIds) {
        const existing = await tx.roster.findFirst({ where: { courseId, userId: uid } });
        if (existing) {
          await tx.roster.update({ where: { id: existing.id }, data: { role: 'STUDENT' } });
        } else {
          await tx.roster.create({ data: { courseId, userId: uid, role: 'STUDENT' } });
        }
      }
    });

    // Log bulk enrollment action
    await createEnhancedActivityLog(prisma, req as unknown as Request, {
      userId: session?.user?.id,
      action: 'BULK_ENROLL_USERS',
      severity: 'INFO',
      category: 'COURSE',
      courseId,
      metadata: {
        userId: session?.user.id,
        courseId: courseId,
        enrolledIds: userIds,
        enrolledCount: userIds.length,
      },
    });
    return NextResponse.json({ success: true, enrolled: userIds.length }, { status: 200 });
  } catch (err) {
    console.error('bulk-enroll error', err);
    await createEnhancedActivityLog(prisma, req as unknown as Request, {
      userId: actorId,
      action: 'COURSE_BULK_ENROLL_ERROR',
      severity: 'ERROR',
      courseId,
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
