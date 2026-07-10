import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

/**
 * Debug helper: returns the signed-in user's own roster entries (with a little
 * course info) plus their id and role. Handy for diagnosing enrollment issues;
 * scoped to the caller, so it exposes nothing about other users.
 * @openapi
 * summary: Inspect my enrollments (debug)
 * responses:
 *   200:
 *     description: The caller's roster entries and role.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             userId: { type: string }
 *             userRole: { type: string }
 *             enrollments: { type: array, items: { type: object } }
 *   401: { description: Not signed in. }
 *   500: { description: Query failed. }
 */
export async function GET() {
  const session = await auth();

  if (!session?.user || session.user.inactive) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const enrollments = await prisma.roster.findMany({
      where: {
        userId: session.user.id,
      },
      include: {
        course: {
          select: {
            id: true,
            name: true,
            code: true,
            isPublished: true,
          },
        },
      },
    });

    return NextResponse.json({
      userId: session.user.id,
      isAdmin: session.user.isAdmin,
      enrollments,
    });
  } catch (error) {
    console.error('Failed to fetch enrollments:', error);
    return NextResponse.json({ error: 'Failed to fetch enrollments' }, { status: 500 });
  }
}
