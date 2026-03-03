import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import type { Prisma } from '@prisma/client';

type CourseRole = 'INSTRUCTOR' | 'FACULTY' | 'TA' | 'STUDENT';

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

    // Map global role to course role
    const mapRole = (r: string | null | undefined): CourseRole => {
        switch (r) {
        case 'ADMIN':
          return 'INSTRUCTOR';
        case 'FACULTY':
          return 'FACULTY';
        case 'TA':
          return 'TA';
        default:
          return 'STUDENT';
      }
    };

    // Fetch all users to get their global roles in a single query
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, role: true },
    });
    const roleMap = new Map(
      users.map((u: { id: string; role: string | null }) => [u.id, mapRole(u.role)]),
    );

    // Enroll all users in a transaction using their inherited roles
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const uid of userIds) {
        const roleToAssign = roleMap.get(uid) ?? 'STUDENT';
        const existing = await tx.roster.findFirst({ where: { courseId, userId: uid } });
        if (existing) {
          // update role to inherited role
          await tx.roster.update({ where: { id: existing.id }, data: { role: roleToAssign } });
        } else {
          await tx.roster.create({ data: { courseId, userId: uid, role: roleToAssign } });
        }
      }
    });

    // Log bulk enrollment action
    await createEnhancedActivityLog(prisma, req as unknown as Request, {
      userId: session?.user?.id,
      action: 'BULK_ENROLL_USERS',
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
