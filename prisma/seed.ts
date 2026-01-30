import { PrismaClient, Role, User } from '@prisma/client';
import { adminData, courseData, facultyData, studentData, taData } from './seed-data';
import { getTermSequence, pickRandom, pickRandomRange, upsertRoster, withRole } from './seed-utils';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('[seed] starting');

  const isProduction = process.env.NODE_ENV === 'production';

  // ===========================
  // Production seeding (admin only, first setup)
  // ===========================
  // Production: only bootstrap the first admin when the DB is empty.
  if (isProduction) {
    let existingUsers = 0;
    try {
      existingUsers = await prisma.user.count();
    } catch (error: any) {
      if (error?.code === 'P2021') {
        console.log('[seed] production: missing tables; run migrations first');
        return;
      }
      throw error;
    }
    if (existingUsers > 0) {
      console.log('[seed] production: users already exist, skipping admin bootstrap');
      return;
    }

    const adminEmail =
      process.env.DEFAULT_ADMIN_EMAIL ||
      process.env.ADMIN_EMAIL ||
      'admin@example.com';
    const adminPassword =
      process.env.DEFAULT_ADMIN_PASSWORD ||
      process.env.ADMIN_PASSWORD ||
      'Password123!';

    const adminFirstName = process.env.DEFAULT_ADMIN_FIRST_NAME || 'Admin';
    const adminLastName = process.env.DEFAULT_ADMIN_LAST_NAME || 'User';

    const prodHashed = await bcrypt.hash(adminPassword, 10);

    await prisma.user.upsert({
      where: { email: adminEmail },
      // If the email already exists (e.g., a student registered first),
      // elevate it to ADMIN for initial setup.
      update: { role: 'ADMIN' },
      create: {
        email: adminEmail,
        firstName: adminFirstName,
        lastName: adminLastName,
        password: prodHashed,
        role: 'ADMIN',
      },
    });

    console.log(
      `[seed] production: created/ensured initial admin user (${adminEmail})`,
    );
    return;
  }

  // Skip seeding in development if users already exist
  // Development: skip seeding if any users already exist.
  let existingUsers = 0;
  try {
    existingUsers = await prisma.user.count();
  } catch (error: any) {
    if (error?.code === 'P2021') {
      console.log('[seed] development: missing tables; run migrations first');
      return;
    }
    throw error;
  }
  if (existingUsers > 0) {
    console.log(
      `[seed] development: ${existingUsers} users exist, skipping seed`,
    );
    return;
  }
  // Hash password for all users
  // Shared dev password for seeded users.
  const hashedPassword = await bcrypt.hash('password123', 10);

  // Create users from seed data with explicit roles.
  const students: User[] = [];

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

  // Store created IDs back into the seed data arrays.
  const setPersonId = (
    list: Array<{ email: string; id?: string }>,
    email: string,
    id: string,
  ) => {
    const person = list.find((item) => item.email === email);
    if (person) {
      person.id = id;
    }
  };

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
      students.push(user);
      setPersonId(studentData, user.email, user.id);
    }
  }

  // ===========================
  // Create Courses
  // ===========================

  // Determine the current academic term and generate rolling term assignments.
  const now = new Date();

  type Term = 'Spring' | 'Summer' | 'Fall';

  // Map a date to its academic term bucket.
  const getTermForDate = (date: Date): Term => {
    const month = date.getMonth();
    if (month <= 4) return 'Spring';
    if (month <= 6) return 'Summer';
    return 'Fall';
  };

  // Generate start/end dates for a given term/year.
  const getTermDates = (term: Term, year: number) => {
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


  // Collect seeded users by role for roster assignment.
  const facultyUsers = facultyData.filter((faculty) => faculty.id) as Array<
    typeof facultyData[number] & { id: string }
  >;
  const taUsers = taData.filter((ta) => ta.id) as Array<
    typeof taData[number] & { id: string }
  >;
  const studentUsers = studentData.filter((student) => student.id) as Array<
    typeof studentData[number] & { id: string }
  >;

  // Randomly assign instructor/TA/students per course.
  for (const course of courses) {
    const instructor = pickRandom(facultyUsers);
    if (instructor) {
      await upsertRoster(prisma, course.id, instructor.id, 'INSTRUCTOR');
    }

    const assignTa = taUsers.length > 0 && Math.random() < 0.7;
    if (assignTa) {
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


  // Count entities for summary logging.
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
