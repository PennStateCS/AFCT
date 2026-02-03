// /src/app/api/courses/route.ts

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validationResponse } from '@/lib/zod-error';
import type { Prisma } from '@prisma/client';

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

    // Group roster by role (treat INSTRUCTOR like FACULTY for display and permissions)
    const formatted = courses.map((c: (typeof courses)[number]) => {
      // Build single `enrolled` list (user objects with courseRole). Do not construct role-specific arrays here.
      const enrolled = c.roster.map((r: (typeof c.roster)[number]) => ({
        ...r.user,
        courseRole: r.role,
      }));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { roster, ...rest } = c;
      return { ...rest, enrolled };
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
    // 1) Parse payload of information
    const json = await req.json();

    // 2) Optional uniqueness check (code + semester)
    const exists = await prisma.course.findFirst({
      where: { code: json.code, semester: json.semester },
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
    const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const course = await tx.course.create({
        data: {
          name: json.name,
          code: json.code,
          regCode,
          semester: json.semester,
          credits: json.credits,
          startDate: json.startDate, // Date object is fine
          endDate: json.endDate,
          isPublished: json.isPublished ?? false,
          isArchived: false,
        },
      });

      let facultyIds: string[] = [];
      if (Array.isArray(json.facultyIds) && json.facultyIds.length > 0) {
        facultyIds = json.facultyIds as string[];
      }

      let instructorIds: string[] = [];
      if (Array.isArray(json.instructorIds) && json.instructorIds.length > 0) {
        instructorIds = json.instructorIds as string[];
      }

      const instructorSet = new Set(instructorIds);
      facultyIds = facultyIds.filter((el: string) => !instructorSet.has(el));

      if (facultyIds.length > 0) {
        await tx.roster.createMany({
          data: facultyIds.map((userId: string) => ({
            userId,
            courseId: course.id,
            role: 'FACULTY',
          })),
        });
      }

      if (instructorIds.length > 0) {
        await tx.roster.createMany({
          data: instructorIds.map((userId: string) => ({
            userId,
            courseId: course.id,
            role: 'INSTRUCTOR',
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
        withRoster?.roster
          .filter((r: NonNullable<typeof withRoster>['roster'][number]) => r.role === 'FACULTY')
          .map((r: NonNullable<typeof withRoster>['roster'][number]) => r.user) ?? [];

      return { course, faculty, withRoster };
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
          isArchived: created.course.isArchived,
          enrolled:
            created.withRoster?.roster.map((r: any) => ({ ...r.user, courseRole: r.role })) ?? [],
        },
      },
      { status: 201 },
    );
  } catch (err) {
    // If it’s a Zod error, send normalized validation issues
    const resp = validationResponse(err);
    console.error('Course creation failed', err);
    if (resp.status === 400) return resp;

    console.error('Failed to create course:', err);
    return NextResponse.json({ message: 'Server error' }, { status: 500 });
  }
}
