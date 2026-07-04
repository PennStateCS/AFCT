/**
 * Course Join API
 *
 * Responsibilities:
 * - Accept a 6-character registration code
 * - Validate course visibility (published + not archived)
 * - Prevent duplicate enrollment
 * - Create a roster entry using the user's global role
 *
 * Notes:
 * - Admins cannot join courses via this route.
 * - For students, unpublished/archived courses are masked as "not found".
 * - For faculty/admin, unpublished/archived courses return 403 with explicit errors.
 */

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

type Role = 'ADMIN' | 'FACULTY' | 'TA' | 'STUDENT';

/**
 * POST /api/courses/join
 *
 * Body:
 * - code: string (6 chars)
 *
 * Responses:
 * - 200: { success: true, message, course }
 * - 400: invalid code, admin join attempt, or registration not currently open
 * - 401: not authenticated
 * - 403: course unpublished/archived (faculty/admin only)
 * - 404: course not found (or hidden from students)
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { code } = await req.json();
  if (!code || code.length !== 6) {
    return NextResponse.json({ error: 'Invalid course code' }, { status: 400 });
  }

  const course = await prisma.course.findUnique({
    where: { regCode: code.toUpperCase() },
  });

  if (!course) {
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  }

  const userId = session.user.id;
  const role = session.user.role as Role;

  // Check if user is already in roster
  const existing = await prisma.roster.findUnique({
    where: {
      courseId_userId: {
        courseId: course.id,
        userId,
      },
    },
  });

  // Handle courses not published or archived
  if (!course.isPublished && (role == 'ADMIN' || role == 'FACULTY')) {
    // Notify admin or faculty that the course was not publihsed
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'COURSE_JOIN_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
    return NextResponse.json({ error: 'Course not published' }, { status: 403 });
  }

  if (course.isArchived && (role === 'ADMIN' || role == 'FACULTY')) {
    // Notify admin or faculty that the course is archived)
    await createEnhancedActivityLog(prisma, req, {
      userId: session?.user?.id ?? null,
      action: 'COURSE_JOIN_DENIED',
      severity: 'SECURITY',
      metadata: { role: session?.user?.role ?? null },
    });
    return NextResponse.json({ error: 'Course archived' }, { status: 403 });
  }

  if (!course.isPublished || course.isArchived) {
    // Do not tell student course was not published, say it does not exist
    return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  }

  if (role === 'ADMIN') {
    return NextResponse.json({ error: 'Admins cannot register for courses' }, { status: 400 });
  }

  if (existing) {
    return NextResponse.json(
      { error: `You are already registered for this course as ${existing.role}` },
      { status: 400 },
    );
  }

  const registrationOpenAt = course.registrationOpenAt ? new Date(course.registrationOpenAt) : null;
  const registrationCloseAt = course.registrationCloseAt
    ? new Date(course.registrationCloseAt)
    : null;

  if (!registrationOpenAt || !registrationCloseAt) {
    return NextResponse.json(
      { error: 'Registration is currently closed for this course.' },
      { status: 400 },
    );
  }

  const now = Date.now();
  if (now < registrationOpenAt.getTime()) {
    return NextResponse.json(
      { error: 'Registration is not open yet for this course.' },
      { status: 400 },
    );
  }

  if (now > registrationCloseAt.getTime()) {
    return NextResponse.json({ error: 'Registration is closed for this course.' }, { status: 400 });
  }

  // Create roster entry
  try {
    await prisma.roster.create({
      data: {
        courseId: course.id,
        userId,
        role: role, // use user's global role as course role
      },
    });

    await createEnhancedActivityLog(prisma, req, {
      userId,
      action: 'COURSE_JOINED',
      severity: 'INFO',
      category: 'COURSE',
      courseId: course.id,
      metadata: {
        userId,
        courseId: course.id,
        courseCode: course.code,
        courseName: course.name,
        role,
      },
    });
  } catch (error) {
    console.error('POST /api/courses/join error:', error);
    await createEnhancedActivityLog(prisma, req, {
      userId,
      action: 'COURSE_JOIN_ERROR',
      severity: 'ERROR',
      category: 'COURSE',
      metadata: { error: error instanceof Error ? error.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to join the course.' }, { status: 500 });
  }

  let message = '';
  if (role === 'STUDENT') message = `You have successfully joined ${course.name} as a Student.`;
  if (role === 'FACULTY') message = `You have been added as Faculty for ${course.name}.`;
  if (role === 'TA') message = `You have been added as a Teaching Assistant for ${course.name}.`;

  return NextResponse.json({ success: true, message, course });
}
