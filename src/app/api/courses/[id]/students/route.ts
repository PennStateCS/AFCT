// /src/app/api/courses/[id]/students/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  // Extract the course ID from route parameters
  const { id: courseId } = await context.params;

  try {
    // Check that the user is authenticated and authorized
    const session = await auth();
    const user = session?.user;

    if (!user || !['ADMIN', 'FACULTY', 'TA'].includes(user.role)) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session?.user?.id ?? null,
        action: 'COURSE_STUDENTS_ACCESS_DENIED',
        severity: 'SECURITY',
        metadata: { role: session?.user?.role ?? null },
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Query roster entries for the course
    const rosterEntries = await prisma.roster.findMany({
      where: { courseId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // Filter users with STUDENT role
    const students = rosterEntries.filter((r: (typeof rosterEntries)[number]) => r.role === 'STUDENT').map((r: (typeof rosterEntries)[number]) => r.user);

    return NextResponse.json(students);
  } catch (err) {
    console.error('Failed to fetch students:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
