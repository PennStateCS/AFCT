import { PrismaClient } from '@prisma/client';

/**
 * Add a role field to every item in the list.
 */
export const withRole = <T, R>(items: T[], role: R) => items.map((item) => ({ ...item, role }));

/**
 * Pick a random item from a list.
 */
export const pickRandom = <T>(items: T[]): T | undefined => {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
};

/**
 * Pick a random slice of items sized between min and max.
 */
export const pickRandomRange = <T>(items: T[], min: number, max: number): T[] => {
  const count = Math.min(
    items.length,
    Math.max(min, Math.floor(Math.random() * (max - min + 1)) + min),
  );
  const shuffled = [...items].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
};

/**
 * Upsert a roster entry for a given course/user/role.
 */
export const upsertRoster = async (
  prisma: PrismaClient,
  courseId: string,
  userId: string,
  role: 'INSTRUCTOR' | 'TA' | 'STUDENT',
) => {
  await prisma.roster.upsert({
    where: {
      courseId_userId: {
        courseId,
        userId,
      },
    },
    update: { role },
    create: {
      role,
      courseId,
      userId,
    },
  });
};

/**
 * Conditionally seed the initial admin user in production.
 * Returns true if an admin was created/ensured, false if skipped.
 */
export const maybeBootstrapAdmin = async (
  prisma: PrismaClient,
  adminEmail: string,
  adminFirstName: string,
  adminLastName: string,
  hashedPassword: string,
) => {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    console.log('[seed] production: users already exist, skipping admin bootstrap');
    return false;
  }

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'ADMIN' },
    create: {
      email: adminEmail,
      firstName: adminFirstName,
      lastName: adminLastName,
      password: hashedPassword,
      role: 'ADMIN',
    },
  });

  console.log(`[seed] production: created/ensured initial admin user (${adminEmail})`);
  return true;
};

/**
 * Resolve production admin credentials from env and hash the password.
 */
export const getProductionAdminCredentials = async () => {
  const adminEmail =
    process.env.DEFAULT_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword =
    process.env.DEFAULT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'Password123!';
  const adminFirstName = process.env.DEFAULT_ADMIN_FIRST_NAME || 'Admin';
  const adminLastName = process.env.DEFAULT_ADMIN_LAST_NAME || 'User';

  return {
    adminEmail,
    adminFirstName,
    adminLastName,
    adminPassword,
  };
};

type SeedPerson = { id: string };

/**
 * Randomly assign instructors, optional TAs, and 3–5 students per course.
 */
export const assignCourseRosters = async (
  prisma: PrismaClient,
  courses: Array<{ id: string; assignTa: boolean }>,
  facultyUsers: SeedPerson[],
  taUsers: SeedPerson[],
  studentUsers: SeedPerson[],
) => {
  for (const course of courses) {
    const instructor = pickRandom(facultyUsers);
    if (instructor) {
      await upsertRoster(prisma, course.id, instructor.id, 'INSTRUCTOR');
    }

    if (course.assignTa && taUsers.length > 0) {
      const ta = pickRandom(taUsers);
      if (ta) {
        await upsertRoster(prisma, course.id, ta.id, 'TA');
      }
    }

    const courseStudents = pickRandomRange(studentUsers, 3, 5);
    for (const student of courseStudents) {
      await upsertRoster(prisma, course.id, student.id, 'STUDENT');
    }
  }
};
export type Term = 'Spring' | 'Summer' | 'Fall';

/**
 * Determine the academic term for a date.
 */
export const getTermForDate = (date: Date): Term => {
  const month = date.getMonth();
  if (month <= 4) return 'Spring';
  if (month <= 6) return 'Summer';
  return 'Fall';
};

/**
 * Compute term start/end dates for a given term/year.
 */
export const getTermDates = (term: Term, year: number) => {
  if (term === 'Spring') {
    return {
      startDate: new Date(year, 0, 15),
      endDate: new Date(year, 4, 15),
    };
  }

  if (term === 'Summer') {
    return {
      startDate: new Date(year, 5, 15),
      endDate: new Date(year, 6, 31),
    };
  }

  return {
    startDate: new Date(year, 7, 15),
    endDate: new Date(year, 11, 15),
  };
};

/**
 * Build the rolling term sequence: current term + next two.
 */
export const getTermSequence = (currentTerm: Term, currentYear: number) => {
  if (currentTerm === 'Spring') {
    return [
      { term: 'Spring' as Term, year: currentYear },
      { term: 'Summer' as Term, year: currentYear },
      { term: 'Fall' as Term, year: currentYear },
    ];
  }

  if (currentTerm === 'Summer') {
    return [
      { term: 'Summer' as Term, year: currentYear },
      { term: 'Fall' as Term, year: currentYear },
      { term: 'Spring' as Term, year: currentYear + 1 },
    ];
  }

  return [
    { term: 'Fall' as Term, year: currentYear },
    { term: 'Spring' as Term, year: currentYear + 1 },
    { term: 'Summer' as Term, year: currentYear + 1 },
  ];
};

/**
 * Compute and log seed summary counts.
 */
export const logSeedCounts = async (prisma: PrismaClient) => {
  const userCount = await prisma.user.count();
  const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
  const facultyCount = await prisma.user.count({ where: { role: 'FACULTY' } });
  const taCount = await prisma.user.count({ where: { role: 'TA' } });
  const studentCount = await prisma.user.count({ where: { role: 'STUDENT' } });
  const courseCount = await prisma.course.count();
  const problemCount = await prisma.problem.count();
  const assignmentCount = await prisma.assignment.count();
  const rosterCount = await prisma.roster.count();
  const assignmentProblemCount = await prisma.assignmentProblem.count();
  const commentCount = await prisma.comment.count();

  console.log('[seed] completed');
  console.log('[seed] counts');
  console.log(`- admins: ${adminCount}`);
  console.log(`- faculty: ${facultyCount}`);
  console.log(`- tas: ${taCount}`);
  console.log(`- students: ${studentCount}`);
  console.log(`- users total: ${userCount}`);
  console.log(`- courses: ${courseCount}`);
  console.log(`- problems: ${problemCount}`);
  console.log(`- assignments: ${assignmentCount}`);
  console.log(`- rosters: ${rosterCount}`);
  console.log(`- assignment-problems: ${assignmentProblemCount}`);
  console.log(`- comments: ${commentCount}`);
};
