/**
 * Development seed routine.
 *
 * Creates a full sample dataset for local/dev use:
 * - Users (admin, faculty, TAs, students)
 * - Courses with rolling term dates
 * - Randomized rosters (instructors/TAs/students)
 */
import { PrismaClient, Role } from '@prisma/client';
import { adminData, courseData, facultyData, studentData, taData } from './seed-data';
import {
  assignCourseRosters,
  getTermDates,
  getTermForDate,
  getTermSequence,
  logSeedCounts,
  withRole,
} from './seed-utils';
import bcrypt from 'bcrypt';

/**
 * Seed development data.
 *
 * Skips execution if users already exist to avoid overwriting local changes.
 */
export const runDevelopmentSeed = async (prisma: PrismaClient) => {
  console.log('[seed] development: checking for existing users');
  // Skip seeding in development if users already exist.
  let existingUsers = 0;
  try {
    existingUsers = await prisma.user.count();
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2021'
    ) {
      console.log('[seed] development: missing tables; run migrations first');
      return;
    }
    throw error;
  }
  if (existingUsers > 0) {
    console.log(`[seed] development: ${existingUsers} users exist, skipping seed`);
    return;
  }

  console.log('[seed] development: hashing shared password');
  // Shared dev password for seeded users.
  const hashedPassword = await bcrypt.hash('password123', 10);

  // Normalize seed data into a single list with roles applied.
  const userSeeds: Array<{
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
  }> = [
    ...withRole([adminData], 'ADMIN' as Role),
    ...withRole(facultyData, 'FACULTY' as Role),
    ...withRole(taData, 'TA' as Role),
    ...withRole(studentData, 'STUDENT' as Role),
  ];

  console.log(`[seed] development: preparing ${userSeeds.length} users`);

  // Store created IDs back into the seed data arrays.
  const setPersonId = (list: Array<{ email: string; id?: string }>, email: string, id: string) => {
    const person = list.find((item) => item.email === email);
    if (person) {
      person.id = id;
    }
  };

  console.log('[seed] development: creating users');
  // Insert users in bulk (safe to re-run thanks to skipDuplicates).
  await prisma.user.createMany({
    data: userSeeds.map((userSeed) => ({
      email: userSeed.email,
      firstName: userSeed.firstName,
      lastName: userSeed.lastName,
      password: hashedPassword,
      role: userSeed.role,
    })),
    skipDuplicates: true,
  });

  // Fetch back created users so we can capture their IDs.
  console.log('[seed] development: fetching created users');
  const createdUsers = await prisma.user.findMany({
    where: { email: { in: userSeeds.map((seed) => seed.email) } },
  });

  const usersByEmail = new Map(createdUsers.map((user) => [user.email, user]));

  // Map IDs to the in-memory seed arrays for later use.
  for (const userSeed of userSeeds) {
    const user = usersByEmail.get(userSeed.email);
    if (!user) continue;

    if (userSeed.role === 'ADMIN') {
      adminData.id = user.id;
    } else if (userSeed.role === 'FACULTY') {
      setPersonId(facultyData, user.email, user.id);
    } else if (userSeed.role === 'TA') {
      setPersonId(taData, user.email, user.id);
    } else if (userSeed.role === 'STUDENT') {
      setPersonId(studentData, user.email, user.id);
    }
  }

  console.log('[seed] development: computing term dates');
  // Determine the current academic term and generate rolling term assignments.
  const now = new Date();
  const currentTerm = getTermForDate(now);
  const currentYear = now.getFullYear();
  const termSequence = getTermSequence(currentTerm, currentYear);

  // Assign each course to current/next/after term, repeating for extra courses.
  const courseDates = courseData.map((_, index) => {
    const term = termSequence[index % termSequence.length];
    return getTermDates(term.term, term.year);
  });

  const courseSemesters = courseData.map((_, index) => {
    const term = termSequence[index % termSequence.length];
    return `${term.term} ${term.year}`;
  });

  console.log(`[seed] development: upserting ${courseData.length} courses`);
  // Upsert courses and capture IDs back into seed data.
  const courses = await Promise.all(
    courseData.map((courseSeed, index) =>
      prisma.course.upsert({
        where: { regCode: courseSeed.regCode },
        update: {
          name: courseSeed.title,
          code: courseSeed.code,
          semester: courseSemesters[index],
          credits: courseSeed.credits,
          startDate: courseDates[index].startDate,
          endDate: courseDates[index].endDate,
          isPublished: courseSeed.isPublished,
          isArchived: courseSeed.isArchived,
        },
        create: {
          name: courseSeed.title,
          code: courseSeed.code,
          regCode: courseSeed.regCode,
          semester: courseSemesters[index],
          credits: courseSeed.credits,
          startDate: courseDates[index].startDate,
          endDate: courseDates[index].endDate,
          isPublished: courseSeed.isPublished,
          isArchived: courseSeed.isArchived,
        },
      }),
    ),
  );

  courses.forEach((course, index) => {
    courseData[index].id = course.id;
  });

  console.log('[seed] development: preparing rosters');
  // Collect seeded users by role for roster assignment.
  const facultyUsers = facultyData.filter((faculty) => faculty.id) as Array<
    (typeof facultyData)[number] & { id: string }
  >;
  const taUsers = taData.filter((ta) => ta.id) as Array<(typeof taData)[number] & { id: string }>;
  const studentUsers = studentData.filter((student) => student.id) as Array<
    (typeof studentData)[number] & { id: string }
  >;

  console.log('[seed] development: assigning course rosters');
  // Randomly assign instructor/TA/students per course.
  await assignCourseRosters(
    prisma,
    courses.map((course, index) => ({
      id: course.id,
      assignTa: courseData[index].assignTa,
    })),
    facultyUsers,
    taUsers,
    studentUsers,
  );

  console.log('[seed] development: counting seeded records');
  // Report counts for quick verification in logs.
  await logSeedCounts(prisma);
};
