import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import type { Prisma } from '@prisma/client';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await params;
  const courseId = resolved.id;

  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Only faculty/admin/ta can bulk enroll
    const role = session.user.role;
    if (!['FACULTY', 'ADMIN', 'TA'].includes(role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
