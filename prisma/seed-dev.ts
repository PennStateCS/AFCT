/**
 * Development seed routine.
 *
 * Creates a full sample dataset for local/dev use:
 * - Users (admin, faculty, TAs, students)
 * - Courses with rolling term dates
 * - Randomized rosters (instructors/TAs/students)
 * - Problems for each course
 */
import { PrismaClient, Role } from '@prisma/client';
import {
  adminData,
  assignmentData,
  courseData,
  facultyData,
  problemData,
  studentData,
  taData,
} from './seed-data';
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
    const dates = getTermDates(term.term, term.year);

    // Set times to 11:59 PM EST/EDT (America/New_York)
    // EST is UTC-5, EDT is UTC-4. To get 11:59 PM in New York time,
    // we need to store as 4:59 AM UTC (11:59 PM + 5 hours for EST)
    const startDate = new Date(dates.startDate);
    startDate.setHours(23, 59, 0, 0);
    startDate.setTime(startDate.getTime() + 5 * 60 * 60 * 1000); // Add 5 hours for EST offset

    const endDate = new Date(dates.endDate);
    endDate.setHours(23, 59, 0, 0);
    endDate.setTime(endDate.getTime() + 5 * 60 * 60 * 1000); // Add 5 hours for EST offset

    return { startDate, endDate };
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
          registrationOpenAt: courseDates[index].startDate,
          registrationCloseAt: courseDates[index].endDate,
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
          registrationOpenAt: courseDates[index].startDate,
          registrationCloseAt: courseDates[index].endDate,
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

  console.log('[seed] development: creating problems for courses');
  // Create problems for each course. All courses get the same problems.
  const createdProblems: { [courseId: string]: Array<{ id: string; title: string }> } = {};

  try {
    // Prepare all problem data for batch insertion
    const problemsToCreate = courses.flatMap((course) =>
      problemData.map((problemSeed) => ({
        title: problemSeed.title,
        description: problemSeed.description,
        fileName: problemSeed.fileName,
        originalFileName: problemSeed.originalFileName,
        type: problemSeed.type,
        maxStates: problemSeed.maxStates,
        isDeterministic: problemSeed.isDeterministic,
        courseId: course.id,
      })),
    );

    const createdProblemRecords = await prisma.problem.createMany({
      data: problemsToCreate,
    });

    // Fetch created problems to map them back to courses
    const allProblems = await prisma.problem.findMany({
      where: { courseId: { in: courses.map((c) => c.id) } },
    });

    for (const course of courses) {
      createdProblems[course.id] = allProblems
        .filter((p) => p.courseId === course.id)
        .map((p) => ({ id: p.id, title: p.title }));
    }

    console.log(`[seed] development: created ${createdProblemRecords.count} problems`);
  } catch (error) {
    console.error('[seed] development: error creating problems', error);
    throw error;
  }

  console.log('[seed] development: creating assignments for courses');
  // Create assignments for each course. All courses get the same assignments.
  const createdAssignments: { [courseId: string]: Array<{ id: string; title: string }> } = {};

  try {
    // Prepare all assignment data for batch insertion
    const assignmentsToCreate = courses.flatMap((course) =>
      assignmentData.map((assignmentSeed) => {
        // Calculate due date based on dueFraction and course endDate
        const courseStart = new Date(course.startDate);
        const courseDuration = new Date(course.endDate).getTime() - courseStart.getTime();
        const dueDateMs = courseStart.getTime() + courseDuration * assignmentSeed.dueFraction;

        return {
          title: assignmentSeed.title,
          description: assignmentSeed.description,
          dueDate: new Date(dueDateMs),
          isPublished: assignmentSeed.isPublished,
          courseId: course.id,
        };
      }),
    );

    const createdAssignmentRecords = await prisma.assignment.createMany({
      data: assignmentsToCreate,
    });

    // Fetch created assignments to map them back to courses
    const allAssignments = await prisma.assignment.findMany({
      where: { courseId: { in: courses.map((c) => c.id) } },
    });

    for (const course of courses) {
      createdAssignments[course.id] = allAssignments
        .filter((a) => a.courseId === course.id)
        .map((a) => ({ id: a.id, title: a.title }));
    }

    console.log(`[seed] development: created ${createdAssignmentRecords.count} assignments`);
  } catch (error) {
    console.error('[seed] development: error creating assignments', error);
    throw error;
  }

  console.log('[seed] development: assigning problems to assignments');
  // Assign problems to assignments for each course
  try {
    const assignmentProblemsToCreate: Array<{
      assignmentId: string;
      problemId: string;
    }> = [];

    for (const course of courses) {
      const courseProblems = createdProblems[course.id] || [];
      const courseAssignments = createdAssignments[course.id] || [];

      if (courseProblems.length === 0 || courseAssignments.length === 0) {
        continue;
      }

      // For each assignment, assign 2-3 problems from the course
      for (const assignment of courseAssignments) {
        // Randomly pick 2-3 problems for this assignment
        const numProblemsToAssign = Math.floor(Math.random() * 2) + 2; // 2 or 3
        const selectedProblems = courseProblems
          .sort(() => Math.random() - 0.5) // Shuffle
          .slice(0, Math.min(numProblemsToAssign, courseProblems.length));

        for (const problem of selectedProblems) {
          assignmentProblemsToCreate.push({
            assignmentId: assignment.id,
            problemId: problem.id,
          });
        }
      }
    }

    const createdAssignmentProblems = await prisma.assignmentProblem.createMany({
      data: assignmentProblemsToCreate,
      skipDuplicates: true,
    });

    console.log(
      `[seed] development: created ${createdAssignmentProblems.count} assignment-problem relationships`,
    );
  } catch (error) {
    console.error('[seed] development: error assigning problems to assignments', error);
    throw error;
  }

  console.log('[seed] development: seeding system settings');
  // Upsert system settings
  try {
    await prisma.systemSettings.upsert({
      where: { id: 1 },
      update: {
        maxUploadSizeMb: 25,
        timezone: 'America/New_York',
      },
      create: {
        id: 1,
        maxUploadSizeMb: 25,
        timezone: 'America/New_York',
      },
    });
    console.log('[seed] development: system settings configured (25MB, America/New_York)');
  } catch (error) {
    console.error('[seed] development: error seeding system settings', error);
    throw error;
  }

  console.log('[seed] development: counting seeded records');
  // Report counts for quick verification in logs.
  await logSeedCounts(prisma);
};
