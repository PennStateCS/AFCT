// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seeding...');

  // 🚦 Skip seeding if users already exist
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0) {
    console.log(`Database already has ${existingUsers} users. Skipping seed.`);
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  // ===========================
  // Production seeding
  // ===========================
  if (isProduction) {
    const prodHashed = await bcrypt.hash('Password123!', 10);
    await prisma.user.upsert({
      where: { email: 'admin@example.com' },
      update: {},
      create: {
        email: 'admin@example.com',
        firstName: 'Admin',
        lastName: 'User',
        password: prodHashed,
        role: 'ADMIN',
      },
    });
    console.log(
      'Production seed complete: created/ensured single admin user (admin@example.com)',
    );
    return;
  }

  // ===========================
  // Development seeding 
  // ===========================

  const hashedPassword = await bcrypt.hash('password123', 10);

  // Admin user
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      password: hashedPassword,
      role: 'ADMIN',
    },
  });

  // Faculty users
  await prisma.user.upsert({
    where: { email: 'faculty@example.com' },
    update: {},
    create: {
      email: 'faculty@example.com',
      firstName: 'Jeffrey',
      lastName: 'Chiampi',
      password: hashedPassword,
      role: 'FACULTY',
    },
  });

  await prisma.user.upsert({
    where: { email: 'faculty2@example.com' },
    update: {},
    create: {
      email: 'faculty2@example.com',
      firstName: 'Bruce',
      lastName: 'Wayne',
      password: hashedPassword,
      role: 'FACULTY',
    },
  });

  // TA users
  await prisma.user.upsert({
    where: { email: 'ta1@example.com' },
    update: {},
    create: {
      email: 'ta1@example.com',
      firstName: 'Diana',
      lastName: 'Prince',
      password: hashedPassword,
      role: 'TA',
    },
  });

  await prisma.user.upsert({
    where: { email: 'ta2@example.com' },
    update: {},
    create: {
      email: 'ta2@example.com',
      firstName: 'Hal',
      lastName: 'Jordan',
      password: hashedPassword,
      role: 'TA',
    },
  });

  // Students
  const studentData = [
    { email: 'student@example.com', firstName: 'Oliver', lastName: 'Green',},
    { email: 'student1@example.com', firstName: 'Peter', lastName: 'Parker' },
    { email: 'student2@example.com', firstName: 'Tony', lastName: 'Stark' },
    { email: 'student3@example.com', firstName: 'Steve', lastName: 'Rogers' },
    { email: 'student4@example.com', firstName: 'Natasha', lastName: 'Romanoff' },
    { email: 'student5@example.com', firstName: 'Thor', lastName: 'Odinson' },
    { email: 'student6@example.com', firstName: 'Clint', lastName: 'Barton' },
    { email: 'student7@example.com', firstName: 'Wanda', lastName: 'Maximoff' },
    { email: 'student8@example.com', firstName: 'Vision', lastName: 'Android' },
    { email: 'student9@example.com', firstName: 'Sam', lastName: 'Wilson' },
    { email: 'student10@example.com', firstName: 'Bucky', lastName: 'Barnes' },
    { email: 'student11@example.com', firstName: 'Scott', lastName: 'Lang' },
    { email: 'student12@example.com', firstName: 'Hope', lastName: 'Van Dyne' },
    { email: 'student13@example.com', firstName: 'Carol', lastName: 'Danvers' },
    { email: 'student14@example.com', firstName: 'Stephen', lastName: 'Strange' },
    { email: 'student15@example.com', firstName: "T'Challa", lastName: 'Wakanda' },
    { email: 'student16@example.com', firstName: 'Shuri', lastName: 'Wakanda' },
    { email: 'student17@example.com', firstName: 'Kurt', lastName: 'Wagner' },
    { email: 'student18@example.com', firstName: 'Jean', lastName: 'Gray' },
    { email: 'student19@example.com', firstName: 'Logan', lastName: 'Howlett' },
    { email: 'student20@example.com', firstName: 'Ororo', lastName: 'Monroe' },
    { email: 'student21@example.com', firstName: 'Remy', lastName: 'LeBeau' },
    { email: 'student22@example.com', firstName: 'Bruce', lastName: 'Banner' },
    { email: 'student23@example.com', firstName: 'Hank', lastName: 'McCoy' },
    { email: 'student24@example.com', firstName: 'Miles', lastName: 'Morales' },
    { email: 'student25@example.com', firstName: 'Gwen', lastName: 'Stacy' },
  ];

  for (const s of studentData) {
    await prisma.user.upsert({
      where: { email: s.email },
      update: {},
      create: {
        email: s.email,
        firstName: s.firstName,
        lastName: s.lastName,
        password: hashedPassword,
        role: 'STUDENT',
      },
    });
  }

  // Courses
  await prisma.course.upsert({
    where: { id: 'cmdnw26cf0000lv14s4q5v73b' },
    update: {},
    create: {
      id: 'cmdnw26cf0000lv14s4q5v73b',
      name: 'Programming and Computation I: Fundamentals',
      code: 'CMPSC 131',
      regCode: 'VSU053',
      semester: 'Spring 2026',
      credits: 3,
      startDate: new Date('2025-07-10T03:59:00.000Z'),
      endDate: new Date('2025-09-18T03:59:00.000Z'),
      isPublished: true,
      isArchived: false,
    },
  });

  await prisma.course.upsert({
    where: { id: 'cmdoowaql0000lvesz3qanxph' },
    update: {},
    create: {
      id: 'cmdoowaql0000lvesz3qanxph',
      name: 'Computer Science Foundations',
      code: 'CS 101',
      regCode: 'ABC123',
      semester: 'Fall 2025',
      credits: 4,
      startDate: new Date('2025-08-15T03:59:00.000Z'),
      endDate: new Date('2025-12-15T03:59:00.000Z'),
      isPublished: true,
      isArchived: false,
    },
  });

  console.log('Development seed complete: users (all) and courses created.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
