// prisma/seed.ts

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seeding...');
  // If running in production, only ensure a single admin exists with the
  // specified production password and exit. The rest of the sample data is
  // intended for development only.
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
    console.log('Production seed complete: created/ensured single admin user (admin@example.com)');
    return;
  }

  // Hash password for all development users
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

  // Create Faculty Users
  const faculty1 = await prisma.user.upsert({
    where: { email: 'faculty@example.com' },
    update: {},
    create: {
      email: 'faculty@example.com',
      firstName: 'Jeffrey',
      lastName: 'Chiampi',
      password: hashedPassword,
      role: 'FACULTY',
      avatar: 'cmdc7t2vy0001lvu0zgeec2g2_1753058269605_8285cd86-ad03-4cc4-8a36-9753173d9ad3.jpg',
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

  // Create TA Users
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

  // Create Sample Students
  const students = [];
  const studentData = [
    {
      email: 'student@example.com',
      firstName: 'Oliver',
      lastName: 'Green',
      avatar: 'cmdc7t2xq0007lvu0v3e504di_1753582590136_a9b637f5-e376-4e56-80c9-4f5f94ae795c.avif',
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
      avatar: 'cmdc7t2xu000glvu06d3gotwx_1753583314285_c9b3ca75-5fcc-4fea-9e18-def9e438024c.jpg',
    },
    { email: 'student19@example.com', firstName: 'Logan', lastName: 'Howlett' },
    { email: 'student20@example.com', firstName: 'Ororo', lastName: 'Monroe' },
    { email: 'student21@example.com', firstName: 'Remy', lastName: 'LeBeau' },
    {
      email: 'student22@example.com',
      firstName: 'Bruce',
      lastName: 'Banner',
      avatar: 'cmdc7t2y0000rlvu0j92i2qx1_1753583537015_57f649b2-6363-4eae-a809-8c8307717e02.jpg',
    },
    { email: 'student23@example.com', firstName: 'Hank', lastName: 'McCoy' },
    {
      email: 'student24@example.com',
      firstName: 'Miles',
      lastName: 'Morales',
      avatar: 'cmdc7t2y9000tlvu0hdcfufh2_1753583866075_43e50ce3-e083-43f1-9a14-a0ff19198e73.jpg',
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

  // Create Courses
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

  // Create Course Roster Entries
  await prisma.roster.upsert({
    where: { id: 'cmdnw26cm0001lv14v5vxo26o' },
    update: {},
    create: {
      id: 'cmdnw26cm0001lv14v5vxo26o',
      role: 'FACULTY',
      courseId: course1.id,
      userId: faculty1.id,
    },
  });

  await prisma.roster.upsert({
    where: { id: 'cmdnwnlp4000blvowamx2a2z9' },
    update: {},
    create: {
      id: 'cmdnwnlp4000blvowamx2a2z9',
      role: 'TA',
      courseId: course1.id,
      userId: ta1.id,
    },
  });

  await prisma.roster.upsert({
    where: { id: 'cmdoowaqx0001lvesqduvsw2v' },
    update: {},
    create: {
      id: 'cmdoowaqx0001lvesqduvsw2v',
      role: 'FACULTY',
      courseId: course2.id,
      userId: faculty2.id,
    },
  });

  // Add some students to courses (check for existing entries first)
  const studentsInCourse1 = students.slice(0, 5);
  const studentsInCourse2 = students.slice(5, 10);

  let rosterIdCounter = 1;
  for (const student of studentsInCourse1) {
    const existingRoster = await prisma.roster.findUnique({
      where: {
        courseId_userId: {
          courseId: course1.id,
          userId: student.id,
        },
      },
    });

    if (!existingRoster) {
      await prisma.roster.create({
        data: {
          id: `roster_${rosterIdCounter}`,
          role: 'STUDENT',
          courseId: course1.id,
          userId: student.id,
        },
      });
    }
    rosterIdCounter++;
  }

  for (const student of studentsInCourse2) {
    const existingRoster = await prisma.roster.findUnique({
      where: {
        courseId_userId: {
          courseId: course2.id,
          userId: student.id,
        },
      },
    });

    if (!existingRoster) {
      await prisma.roster.create({
        data: {
          id: `roster_${rosterIdCounter}`,
          role: 'STUDENT',
          courseId: course2.id,
          userId: student.id,
        },
      });
    }
    rosterIdCounter++;
  }

  // Create Problems
  const problem1 = await prisma.problem.upsert({
    where: { id: 'cmdqm15uk0001lvdgybyjred8' },
    update: {},
    create: {
      id: 'cmdqm15uk0001lvdgybyjred8',
      title: 'Test',
      description: '123',
      fileName: '1753918906842-fake_solution.txt',
      originalFileName: 'fake_solution.txt',
      type: 'FA',
      maxStates: -1,
      isDeterministic: false,
      courseId: course1.id,
    },
  });

  const problem2 = await prisma.problem.upsert({
    where: { id: 'cme36maxh000hlvp8eq6ik0ae' },
    update: {},
    create: {
      id: 'cme36maxh000hlvp8eq6ik0ae',
      title: '1.1',
      description: 'Test',
      fileName: '1754679079632-fake_solution.txt',
      originalFileName: 'fake_solution.txt',
      type: 'FA',
      maxStates: 5,
      isDeterministic: true,
      courseId: course2.id,
    },
  });

  // Create Assignments
  const assignment1 = await prisma.assignment.upsert({
    where: { id: 'cmdnwyb8k0000lvjcjctu5em3' },
    update: {},
    create: {
      id: 'cmdnwyb8k0000lvjcjctu5em3',
      title: 'Chapter 1',
      description:
        'For this Chapter 1 homework, you will review the key concepts introduced in the first chapter, including basic terminology and foundational principles. The assignment consists of a mix problems. No submissions will be accepted late.',
      dueDate: new Date('2026-06-29T03:59:00.000Z'),
      maxPoints: 100,
      isPublished: true,
      courseId: course1.id,
    },
  });

  const assignment2 = await prisma.assignment.upsert({
    where: { id: 'cmdp906y10001lviwgpo84uwd' },
    update: {},
    create: {
      id: 'cmdp906y10001lviwgpo84uwd',
      title: 'Chapter 2',
      description: 'This is a test description.',
      dueDate: new Date('2025-09-30T03:59:00.000Z'),
      maxPoints: 100,
      isPublished: false,
      courseId: course1.id,
    },
  });

  const assignment3 = await prisma.assignment.upsert({
    where: { id: 'cme36mhff000jlvp8rfgql6mh' },
    update: {},
    create: {
      id: 'cme36mhff000jlvp8rfgql6mh',
      title: 'Homework 1',
      description: 'Basic automata problems',
      dueDate: new Date('2025-12-01T03:59:00.000Z'),
      maxPoints: 50,
      isPublished: true,
      courseId: course2.id,
    },
  });

  // Link Problems to Assignments
  await prisma.assignmentProblem.upsert({
    where: {
      assignmentId_problemId: {
        assignmentId: assignment1.id,
        problemId: problem1.id,
      },
    },
    update: {},
    create: {
      assignmentId: assignment1.id,
      problemId: problem1.id,
    },
  });

  await prisma.assignmentProblem.upsert({
    where: {
      assignmentId_problemId: {
        assignmentId: assignment2.id,
        problemId: problem1.id,
      },
    },
    update: {},
    create: {
      assignmentId: assignment2.id,
      problemId: problem1.id,
    },
  });

  await prisma.assignmentProblem.upsert({
    where: {
      assignmentId_problemId: {
        assignmentId: assignment3.id,
        problemId: problem2.id,
      },
    },
    update: {},
    create: {
      assignmentId: assignment3.id,
      problemId: problem2.id,
    },
  });

  console.log('Database seeded successfully!');
  console.log(`Created:`);
  console.log(`- 1 Admin user`);
  console.log(`- 3 Faculty users`);
  console.log(`- 2 TA users`);
  console.log(`- ${students.length} Student users`);
  console.log(`- 2 Courses`);
  console.log(`- 2 Problems`);
  console.log(`- 3 Assignments`);
  console.log(`- Course roster memberships`);
  console.log(`- Assignment-Problem linkages`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
