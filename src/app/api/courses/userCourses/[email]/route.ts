import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

// ----------------------------------------
// GET /api/courses/userCourses/[email]
// ----------------------------------------
export async function GET(req: Request, context: { params: Promise<{ email: string }> }) {
  const { email } = await context.params;

  // 1. Make sure the email is not missing
  if (!email) {
    return NextResponse.json({ error: 'Missing email' }, { status: 400 });
  }

  // 2. Verify user
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Find courses where the user is enrolled in and the course has already started
    const courses = await prisma.course.findMany({
      // Find where user's enrollment exists and the course is not archived and has started
      where: {
        roster: {
          some: {
            // Use the userId instead of the user's email to prevent enumeration
            userId: session.user.id,
          }
        },
        isArchived: false,
        startDate: { lte: new Date() }, // Only return courses whose startDate is in the past (<= now)
      },

      // Select the course's id and name
      select: {
        id: true,
        name: true
      }
    })

    // No error? Return the id, name and a working status code
    return NextResponse.json(courses, { status: 200 });
  } catch (error) { // Catch any errors and state the fetch failed
    console.error('Failed to fetch courses:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
