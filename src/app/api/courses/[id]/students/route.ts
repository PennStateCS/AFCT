import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: courseId } = await context.params;

  try {
    const rosterEntries = await prisma.roster.findMany({
      where: { courseId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true, // ✅ include email here
            role: true,
          },
        },
      },
    });

    const students = rosterEntries.filter((r) => r.role === 'STUDENT').map((r) => r.user);

    return NextResponse.json(students);
  } catch (err) {
    console.error('Failed to fetch students:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
