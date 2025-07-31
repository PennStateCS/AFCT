import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

async function generateUniqueCourseCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';

  function randomCode() {
    const part1 = Array.from(
      { length: 3 },
      () => letters[Math.floor(Math.random() * letters.length)],
    ).join('');
    const part2 = Array.from(
      { length: 3 },
      () => numbers[Math.floor(Math.random() * numbers.length)],
    ).join('');
    return `${part1}${part2}`.toUpperCase();
  }

  let code: string;
  let exists = true;

  do {
    code = randomCode();
    const existing = await prisma.course.findUnique({ where: { regCode: code } });
    exists = !!existing;
  } while (exists);

  return code;
}

export async function GET() {
  try {
    const courses = await prisma.course.findMany({
      include: {
        roster: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, role: true },
            },
          },
        },
        assignments: {
          include: {
            problems: {
              include: {
                problem: { select: { id: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Convert roster into grouped arrays
    const formatted = courses.map((c) => {
      const faculty = c.roster.filter((r) => r.role === 'FACULTY').map((r) => r.user);
      const tas = c.roster.filter((r) => r.role === 'TA').map((r) => r.user);
      const students = c.roster.filter((r) => r.role === 'STUDENT').map((r) => r.user);

      const { roster, ...rest } = c;
      return { ...rest, faculty, tas, students };
    });

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Failed to fetch courses:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, code, semester, credits, startDate, endDate, isPublished, facultyIds } = body;

    if (
      !name ||
      !code ||
      !semester ||
      !credits ||
      !startDate ||
      !endDate ||
      !Array.isArray(facultyIds)
    ) {
      return new NextResponse('Missing or invalid fields', { status: 400 });
    }

    const regCode = await generateUniqueCourseCode();

    const course = await prisma.course.create({
      data: {
        name,
        code,
        regCode,
        semester,
        credits,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isPublished: isPublished ?? false,
      },
    });

    if (facultyIds.length > 0) {
      await prisma.roster.createMany({
        data: facultyIds.map((userId: string) => ({
          userId,
          courseId: course.id,
          role: 'FACULTY',
        })),
      });
    }

    const createdCourse = await prisma.course.findUnique({
      where: { id: course.id },
      include: {
        roster: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    const faculty =
      createdCourse?.roster.filter((r) => r.role === 'FACULTY').map((r) => r.user) ?? [];

    return NextResponse.json(
      {
        success: true,
        message: 'Course created successfully',
        course: {
          id: course.id,
          name: course.name,
          code: course.code,
          regCode: course.regCode,
          semester: course.semester,
          credits: course.credits,
          startDate: course.startDate,
          endDate: course.endDate,
          isPublished: course.isPublished,
          faculty,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Failed to create course:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
