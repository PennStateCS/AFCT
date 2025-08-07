// /src/api/courses/[id]/assignments/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken } from '@/app/utils/jwt';

// GET: Fetch all published assignments for a course
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  // Extract the Bearer token from the Authorization header
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.split(' ')[1];

  // Verify and decode the JWT
  const decoded = token ? verifyToken(token) : null;

  if (!decoded) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Step 1: Ensure the course exists
    const course = await prisma.course.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    // Step 2: Fetch all published assignments for this course
    const assignments = await prisma.assignment.findMany({
      where: {
        courseId: params.id,
        isPublished: true,
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    // Step 3: Return the assignments as a JSON response
    return NextResponse.json(assignments);
  } catch (error) {
    // Catch and log any server-side errors
    console.error('API GET ASSIGNMENTS error:', error);
    return NextResponse.json({ error: 'Failed to fetch assignments.' }, { status: 500 });
  }
}
