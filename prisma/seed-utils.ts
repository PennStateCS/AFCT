import { randomInt } from 'node:crypto';
import type { PrismaClient, CourseRole } from '@prisma/client';

/**
 * Add a role field to every item in the list.
 */
export const withRole = <T, R>(items: T[], role: R) => items.map((item) => ({ ...item, role }));

/**
 * Pick a random item from a list. Uses the CSPRNG (`node:crypto`) for a uniform,
 * unbiased pick.
 */
export const pickRandom = <T>(items: T[]): T | undefined => {
  if (items.length === 0) return undefined;
  return items[randomInt(items.length)];
};

/**
 * Pick a random slice of items sized between min and max. Uses an unbiased
 * Fisher–Yates shuffle backed by the CSPRNG (`node:crypto`).
 */
export const pickRandomRange = <T>(items: T[], min: number, max: number): T[] => {
  const count = Math.min(items.length, Math.max(min, randomInt(min, max + 1)));
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  return shuffled.slice(0, count);
};

/**
 * Upsert a roster entry for a given course/user/role.
 */
export const upsertRoster = async (
  prisma: PrismaClient,
  courseId: string,
  userId: string,
  role: CourseRole,
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
    update: { isAdmin: true },
    create: {
      email: adminEmail,
      firstName: adminFirstName,
      lastName: adminLastName,
      password: hashedPassword,
      isAdmin: true,
      // Force a password change at first login, so even a shared/temporary
      // bootstrap password can't remain the standing admin credential.
      temporaryPassword: true,
    },
  });

  console.log(`[seed] production: created/ensured initial admin user (${adminEmail})`);
  return true;
};

/**
 * Minimum admin-password strength for the production bootstrap. Mirrors
 * `src/lib/password-policy.ts` (kept inline so the seed pulls in no app-side
 * import at container runtime, where `src/` may not be present).
 */
const isStrongEnoughAdminPassword = (pw: string) =>
  pw.length >= 8 &&
  pw.length <= 72 &&
  /[A-Z]/.test(pw) &&
  /[a-z]/.test(pw) &&
  /\d/.test(pw) &&
  /[^A-Za-z0-9]/.test(pw);

/**
 * Resolve production admin credentials from the environment and hash the password.
 *
 * There is deliberately **no default**: a missing `ADMIN_EMAIL`/`ADMIN_PASSWORD`
 * throws rather than silently bootstrapping a well-known login. With the source
 * public, a hardcoded fallback would be a known admin credential for any
 * deployment that skipped the variable. Callers resolve credentials only when the
 * database is actually empty (see `runProductionSeed`), so a healthy deployment's
 * restarts never require these to be present.
 */
export const getProductionAdminCredentials = async () => {
  const adminEmail = (process.env.ADMIN_EMAIL || process.env.DEFAULT_ADMIN_EMAIL || '').trim();
  const adminPassword = process.env.ADMIN_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD || '';
  const adminFirstName = process.env.DEFAULT_ADMIN_FIRST_NAME || 'Admin';
  const adminLastName = process.env.DEFAULT_ADMIN_LAST_NAME || 'User';

  if (!adminEmail || !adminPassword) {
    throw new Error(
      '[seed] production: ADMIN_EMAIL and ADMIN_PASSWORD must be set to bootstrap the initial ' +
        'admin. Set them in .env.production (the guided installer does this for you) and retry.',
    );
  }
  if (!isStrongEnoughAdminPassword(adminPassword)) {
    throw new Error(
      '[seed] production: ADMIN_PASSWORD is too weak — use at least 8 characters with uppercase, ' +
        'lowercase, a number, and a special character.',
    );
  }

  return {
    adminEmail,
    adminFirstName,
    adminLastName,
    adminPassword,
  };
};

type SeedPerson = { id: string };

/**
 * Randomly assign course admins, optional TAs, and 3–5 students per course.
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
      await upsertRoster(prisma, course.id, instructor.id, 'FACULTY' as CourseRole);
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
/** A course's position relative to "now", independent of the academic term. */
export type CourseLifecycle = 'past' | 'current' | 'future' | 'archived';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Start/end dates for a course pinned to a lifecycle state relative to `now`, so
 * the dev database always has a past, current, future, and archived course no
 * matter when the seed runs (the rolling academic term only moves forward, so it
 * never produces a past course on its own).
 */
export const getLifecycleDates = (lifecycle: CourseLifecycle, now: Date) => {
  const from = (days: number) => new Date(now.getTime() + days * DAY_MS);
  const ranges: Record<CourseLifecycle, { startDate: Date; endDate: Date }> = {
    // Ended a few months ago.
    past: { startDate: from(-210), endDate: from(-120) },
    // Started recently, still running.
    current: { startDate: from(-30), endDate: from(60) },
    // Hasn't started yet.
    future: { startDate: from(45), endDate: from(135) },
    // A long-finished course kept around only to test the archived state.
    archived: { startDate: from(-400), endDate: from(-310) },
  };
  return ranges[lifecycle];
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
  const adminCount = await prisma.user.count({ where: { isAdmin: true } });
  // Faculty/TA/student are now per-course roles, so count roster rows by role.
  const facultyCount = await prisma.roster.count({ where: { role: 'FACULTY' } });
  const taCount = await prisma.roster.count({ where: { role: 'TA' } });
  const studentCount = await prisma.roster.count({ where: { role: 'STUDENT' } });
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
