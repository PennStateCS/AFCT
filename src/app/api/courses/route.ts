// /src/app/api/courses/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CreateCourseSchema } from '@/schemas';
import { validationResponse } from '@/lib/zod-error';

// ----------------------------------------
// Utilities
// ----------------------------------------
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

// ----------------------------------------
// GET /api/courses
// ----------------------------------------
export async function GET() {
  try {
    const courses = await prisma.course.findMany({
      include: {
        roster: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        },
        assignments: {
          include: {
            problems: {
              include: { problem: { select: { id: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group roster by role
    const formatted = courses.map((c) => {
      const faculty = c.roster.filter((r) => r.role === 'FACULTY').map((r) => r.user);
      const tas = c.roster.filter((r) => r.role === 'TA').map((r) => r.user);
      const students = c.roster.filter((r) => r.role === 'STUDENT').map((r) => r.user);

      const { roster, ...rest } = c;
      return { ...rest, faculty, tas, students };
    });

    return NextResponse.json(formatted, { status: 200 });
  } catch (error) {
    console.error('Failed to fetch courses:', error);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}

// ----------------------------------------
// POST /api/courses
// ----------------------------------------
export async function POST(req: Request) {
  try {
    const json = await req.json();

    // 1) Validate with the shared Zod schema (async supports future async refinements)
    const data = await CreateCourseSchema.parseAsync(json);

    // 2) Optional uniqueness check (code + semester)
    const exists = await prisma.course.findFirst({
      where: { code: data.code, semester: data.semester },
      select: { id: true },
    });
    if (exists) {
      return NextResponse.json(
        { message: 'A course with that code and semester already exists.' },
        { status: 409 },
      );
    }

    // 3) Generate a unique registration code
    const regCode = await generateUniqueCourseCode();

    // 4) Create course (and roster rows for faculty) in a transaction for consistency
    const created = await prisma.$transaction(async (tx) => {
      const course = await tx.course.create({
        data: {
          name: data.name,
          code: data.code,
          regCode,
          semester: data.semester,
          credits: data.credits,
          startDate: data.startDate, // Date object is fine
          endDate: data.endDate,
          isPublished: data.isPublished ?? false,
        },
      });

      if (data.facultyIds.length > 0) {
        await tx.roster.createMany({
          data: data.facultyIds.map((userId) => ({
            userId,
            courseId: course.id,
            role: 'FACULTY',
          })),
        });
      }

      // Re-read with faculty populated for response
      const withRoster = await tx.course.findUnique({
        where: { id: course.id },
        include: {
          roster: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, role: true } },
            },
          },
        },
      });

      const faculty =
        withRoster?.roster.filter((r) => r.role === 'FACULTY').map((r) => r.user) ?? [];

      return { course, faculty };
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Course created successfully',
        course: {
          id: created.course.id,
          name: created.course.name,
          code: created.course.code,
          regCode: created.course.regCode,
          semester: created.course.semester,
          credits: created.course.credits,
          startDate: created.course.startDate,
          endDate: created.course.endDate,
          isPublished: created.course.isPublished,
          faculty: created.faculty,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    // If it’s a Zod error, send normalized validation issues
    const resp = validationResponse(err);
    if (resp.status === 400) return resp;

    console.error('Failed to create course:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
