import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { Role } from '@prisma/client';

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

  // Handle courses not published
  if (!course.isPublished && (session.user.role == 'ADMIN' || session.user.role == 'FACULTY')) { // Notify admin or faculty that the course was not publihsed
    return NextResponse.json({ error: 'Course not published' }, { status: 403 }); 
  }

  if (!course.isPublished) { // Do not tell student course was not published, say it does not exist
    return NextResponse.json({ error: 'Course not found' }, { status: 404 }); 
  }

  const userId = session.user.id;
  const role = session.user.role as Role;

  if (role === 'ADMIN') {
    return NextResponse.json({ error: 'Admins cannot register for courses' }, { status: 400 });
  }

  // Check if user is already in roster
  const existing = await prisma.roster.findUnique({
    where: {
      courseId_userId: {
        courseId: course.id,
        userId,
      },
    },
  });

  if (existing) {
    return NextResponse.json(
      { error: `You are already registered for this course as ${existing.role}` },
      { status: 400 },
    );
  }

  // Create roster entry
  console.log(userId);
  await prisma.roster.create({
    data: {
      courseId: course.id,
      userId,
      role: role, // use user's global role as course role
    },
  });

  let message = '';
  if (role === 'STUDENT') message = `You have successfully joined ${course.name} as a Student.`;
  if (role === 'FACULTY') message = `You have been added as Faculty for ${course.name}.`;
  if (role === 'TA') message = `You have been added as a Teaching Assistant for ${course.name}.`;

  return NextResponse.json({ success: true, message, course });
}
