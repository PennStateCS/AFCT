import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Expects { userId: string }
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { userId } = await req.json();

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  // Find user to get their global role
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  try {
    // Upsert into Roster to avoid duplicates
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
        role: user.role, // use global role as course role
      },
      update: {
        role: user.role, // update role if it changed
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Enrollment error:', error);
    return NextResponse.json({ error: 'Failed to enroll user' }, { status: 500 });
  }
}
