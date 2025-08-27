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

  // If running in production, only ensure a single admin exists
  const isProduction = process.env.NODE_ENV === 'production';
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
      'Production seed complete: created/ensured single admin user (admin@example.com)'
    );
    return;
  }

  // ===========================
  // 🔽 Development seeding 🔽
  // ===========================

  const hashedPassword = await bcrypt.hash('password123', 10);

  // Create Admin User (development)
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

  // Faculty Users
  const faculty1 = await prisma.user.upsert({
    where: { email: 'faculty@example.com' },
    update: {},
    create: {
      email: 'faculty@example.com',
      firstName: 'Jeffrey',
      lastName: 'Chiampi',
      password: hashedPassword,
      role: 'FACULTY',
      avatar:
        'cmdc7t2vy0001lvu0zgeec2g2_1753058269605_8285cd86-ad03-4cc4-8a36-9753173d9ad3.jpg',
    },
  });

  const faculty2 = await prisma.user.upsert({
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

  await prisma.user.upsert({
    where: { email: 'faculty1@example.com' },
    update: {},
    create: {
      email: 'faculty1@example.com',
      firstName: 'Clark',
      lastName: 'Kent',
      password: hashedPassword,
      role: 'FACULTY',
    },
  });

  // TA Users
  const ta1 = await prisma.user.upsert({
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
  const students: any[] = [];
  const studentData = [
    {
      email: 'student@example.com',
      firstName: 'Oliver',
      lastName: 'Green',
      avatar:
        'cmdc7t2xq0007lvu0v3e504di_1753582590136_a9b637f5-e376-4e56-80c9-4f5f94ae795c.avif',
    },
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
    {
      email: 'student18@example.com',
      firstName: 'Jean',
      lastName: 'Gray',
      avatar:
        'cmdc7t2xu000glvu06d3gotwx_1753583314285_c9b3ca75-5fcc-4fea-9e18-def9e438024c.jpg',
    },
    { email: 'student19@example.com', firstName: 'Logan', lastName: 'Howlett' },
    { email: 'student20@example.com', firstName: 'Ororo', lastName: 'Monroe' },
    { email: 'student21@example.com', firstName: 'Remy', lastName: 'LeBeau' },
    {
      email: 'student22@example.com',
      firstName: 'Bruce',
      lastName: 'Banner',
      avatar:
        'cmdc7t2y0000rlvu0j92i2qx1_1753583537015_57f649b2-6363-4eae-a809-8c8307717e02.jpg',
    },
    { email: 'student23@example.com', firstName: 'Hank', lastName: 'McCoy' },
    {
      email: 'student24@example.com',
      firstName: 'Miles',
      lastName: 'Morales',
      avatar:
        'cmdc7t2y9000tlvu0hdcfufh2_1753583866075_43e50ce3-e083-43f1-9a14-a0ff19198e73.jpg',
    },
    { email: 'student25@example.com', firstName: 'Gwen', lastName: 'Stacy' },
  ];

  for (const studentInfo of studentData) {
    const student = await prisma.user.upsert({
      where: { email: studentInfo.email },
      update: {},
      create: {
        email: studentInfo.email,
        firstName: studentInfo.firstName,
        lastName: studentInfo.lastName,
        password: hashedPassword,
        role: 'STUDENT',
        avatar: studentInfo.avatar || null,
      },
    });
    students.push(student);
  }

  // Courses
  const course1 = await prisma.course.upsert({
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
    },
  });

  const course2 = await prisma.course.upsert({
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
    },
  });

  // Rosters, Problems, Assignments …
  // (all your existing roster, problem, and assignment upserts go here unchanged)

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
