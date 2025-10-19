import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ----------------------------------------
// GET /api/courses/userCourses
// ----------------------------------------
export async function GET(_: Request, context: { params: Promise<{ email: string }> }) {
  const { email } = await context.params;

  // Make sure the email is not missing
  if (!email) {
    return NextResponse.json({ error: 'Missing email' }, { status: 400 });
  }

  try {
    // Find courses where the user is enrolled in
    const courses = await prisma.course.findMany({
      // Find where user's email (unique identifier) matches
      where: {
        roster: {
          some:{ user: { email } }
        }
      },

      // Select the course's id and name
      select: {
        id: true,
        name: true,
        roster: {
          include: { user: true } 
        },
      }
    })

    // No error? Return the id, name and a working status code
    return NextResponse.json(courses, { status: 200 });
  } catch (error) { // Catch any errors and state the fetch failed
    console.error('Failed to fetch courses:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}