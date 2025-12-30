import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seeding...');

  // Hash password for all users
  const hashedPassword = await bcrypt.hash('password123', 10);

  // Create Admin User
  const admin = await prisma.user.upsert({
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

  const faculty3 = await prisma.user.upsert({
    where: { email: 'faculty3@example.com' },
    update: {},
    create: {
      email: 'faculty3@example.com',
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

  const ta2 = await prisma.user.upsert({
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

  // ===========================
  // Create Courses
  // ===========================

  // Course 1 (Published, Not Archived, Has Stuff)
  const course1 = await prisma.course.upsert({
    where: { id: 'cmdoowaql0000lvesz3qanxph' },
    update: {},
    create: {
      id: 'cmdoowaql0000lvesz3qanxph',
      name: 'Introduction to Digital Systems',
      code: 'CMPEN 271',
      regCode: 'ABC123',
      semester: 'Fall 2025',
      credits: 4,
      startDate: new Date('2025-08-15T03:59:00.000Z'),
      endDate: new Date('2026-01-15T03:59:00.000Z'),
      isPublished: true,
      isArchived: false,
    },
  });

  // Course 2 (Published, Archived, Has Stuff)
  const course2 = await prisma.course.upsert({
    where: { id: 'cmdqx47bn0003tp19s8vzo52m' },
    update: {},
    create: {
      id: 'cmdqx47bn0003tp19s8vzo52m',
      name: 'Introduction to Digital Systems',
      code: 'CMPEN 271',
      regCode: 'DEF456',
      semester: 'Spring 2025',
      credits: 4,
      startDate: new Date('2025-01-15T03:59:00.000Z'),
      endDate: new Date('2025-05-15T03:59:00.000Z'),
      isPublished: true,
      isArchived: true,
    },
  });

   // Course 3 (Published, Not Archived, Empty)
  const course3 = await prisma.course.upsert({
    where: { id: 'cmdnw83cr0007kv24t5xha91p' },
    update: {},
    create: {
      id: 'cmdnw83cr0007kv24t5xha91p',
      name: 'Programming and Computation I: Fundamentals',
      code: 'CMPSC 131',
      regCode: 'VSU053',
      semester: 'Fall 2025',
      credits: 3,
      startDate: new Date('2025-08-15T03:59:00.000Z'),
      endDate: new Date('2025-12-15T03:59:00.000Z'),
      isPublished: true,
      isArchived: false,
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
    where: { id: 'cmdjg25vm0002gw68m4bqe73x' },
    update: {},
    create: {
      id: 'cmdjg25vm0002gw68m4bqe73x',
      role: 'TA',
      courseId: course1.id,
      userId: ta1.id,
    },
  });

  await prisma.roster.upsert({
    where: { id: 'cmdnw44cm2201lv14v5vox44x' },
    update: {},
    create: {
      id: 'cmdnw44cm2201lv14v5vox44x',
      role: 'FACULTY',
      courseId: course2.id,
      userId: faculty1.id,
    },
  });

  await prisma.roster.upsert({
    where: { id: 'cmdfr61qd0009rx21t7wmo48j' },
    update: {},
    create: {
      id: 'cmdfr61qd0009rx21t7wmo48j',
      role: 'TA',
      courseId: course2.id,
      userId: ta1.id,
    },
  });

  await prisma.roster.upsert({
    where: { id: 'cmdoowaqx0001lvesqduvsw2v' },
    update: {},
    create: {
      id: 'cmdoowaqx0001lvesqduvsw2v',
      role: 'FACULTY',
      courseId: course3.id,
      userId: faculty2.id,
    },
  });

  // Add some students to courses (check for existing entries first)
  const studentsInCourse1 = students.slice(0, 5);
  const studentsInCourse2 = students.slice(5, 9);
  const studentsInCourse3 = students.slice(5, 8);

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

  for (const student of studentsInCourse3) {
    const existingRoster = await prisma.roster.findUnique({
      where: {
        courseId_userId: {
          courseId: course3.id,
          userId: student.id,
        },
      },
    });

    if (!existingRoster) {
      await prisma.roster.create({
        data: {
          id: `roster_${rosterIdCounter}`,
          role: 'STUDENT',
          courseId: course3.id,
          userId: student.id,
        },
      });
    }
    rosterIdCounter++;
  }

  // ===========================
  // Create Problems
  // ===========================

 // Couse 1
  const problem1 = await prisma.problem.upsert({
    where: { id: 'cmioqr2yw000fru6re5kqrm4w' },
    update: {},
    create: {
      id: 'cmioqr2yw000fru6re5kqrm4w',
      title: 'D Flip-Flop',
      description: 'Design the finite automation machine involving a D flip-flop with "q0" being the initial state.',
      fileName: '1764689813955-d_flip-flop.jff',
      originalFileName: 'd_flip-flop.jff',
      type: 'FA',
      maxStates: 2,
      isDeterministic: true,
      courseId: course1.id,
    },
  });

  const problem2 = await prisma.problem.upsert({
    where: { id: 'cmioqqpb10007ru6rgv934ig5' },
    update: {},
    create: {
      id: 'cmioqqpb10007ru6rgv934ig5',
      title: 'Toggle Flip-Flop',
      description: 'Design the finite automation machine involving a toggle flip-flop with "q0" being the initial state.',
      fileName: '1764689796246-toggle_flip-flop.jff',
      originalFileName: 'toggle_flip-flop.jff',
      type: 'FA',
      maxStates: 2,
      isDeterministic: true,
      courseId: course1.id,
    },
  });

  const problem3 = await prisma.problem.upsert({
    where: { id: 'cmioqq1tj0003ru6rmf0vvl4u' },
    update: {},
    create: {
      id: 'cmioqq1tj0003ru6rmf0vvl4u',
      title: 'Traffic Light',
      description: 'Design a traffic light with the states "Green", "Yellow", and "Red" with the "Green" State being the initial state and a high signal causing a change in the light.',
      fileName: '1764689765806-traffic_light.jff',
      originalFileName: 'traffic_light.jff',
      type: 'FA',
      maxStates: 3,
      isDeterministic: false,
      courseId: course1.id,
    },
  });

  const problem4 = await prisma.problem.upsert({
    where: { id: 'cmioqqwvg000bru6re8nk7ko6' },
    update: {},
    create: {
      id: 'cmioqqwvg000bru6re8nk7ko6',
      title: 'Three Consecutive 1s',
      description: 'With "q0" being the initial state, create the finite automation with mininum number of states required to detect three consecutive ones.',
      fileName: '1764689806055-three_consecutive.jff',
      originalFileName: 'three_consecutive.jff',
      type: 'FA',
      maxStates: 4,
      isDeterministic: true,
      courseId: course1.id,
    },
  });

  // Cousre 2
  const problem5 = await prisma.problem.upsert({
    where: { id: 'cmdtv39kl0004lt85v2zpa60n' },
    update: {},
    create: {
      id: 'cmdtv39kl0004lt85v2zpa60n',
      title: 'D Flip-Flop',
      description: 'Design the finite automation machine involving a D flip-flop with "q0" being the initial state.',
      fileName: '1764689813955-d_flip-flop.jff',
      originalFileName: 'd_flip-flop.jff',
      type: 'FA',
      maxStates: 2,
      isDeterministic: true,
      courseId: course2.id,
    },
  });

  const problem6 = await prisma.problem.upsert({
    where: { id: 'cmdpb74cs0006hp33s1mxe92c' },
    update: {},
    create: {
      id: 'cmdpb74cs0006hp33s1mxe92c',
      title: 'Toggle Flip-Flop',
      description: 'Design the finite automation machine involving a toggle flip-flop with "q0" being the initial state.',
      fileName: '1764689796246-toggle_flip-flop.jff',
      originalFileName: 'toggle_flip-flop.jff',
      type: 'FA',
      maxStates: 2,
      isDeterministic: true,
      courseId: course2.id,
    },
  });

  const problem7 = await prisma.problem.upsert({
    where: { id: 'cmdlh58rt0008jy40p6xsa19u' },
    update: {},
    create: {
      id: 'cmdlh58rt0008jy40p6xsa19u',
      title: 'Traffic Light',
      description: 'Design a traffic light with the states "Green", "Yellow", and "Red" with the "Green" State being the initial state and a high signal causing a change in the light.',
      fileName: '1764689765806-traffic_light.jff',
      originalFileName: 'traffic_light.jff',
      type: 'FA',
      maxStates: 3,
      isDeterministic: false,
      courseId: course2.id,
    },
  });

  const problem8 = await prisma.problem.upsert({
    where: { id: 'cmdwv12pm0005fz77r3qhd84t' },
    update: {},
    create: {
      id: 'cmdwv12pm0005fz77r3qhd84t',
      title: 'Three Consecutive 1s',
      description: 'With "q0" being the initial state, create the finite automation with mininum number of states required to detect three consecutive ones.',
      fileName: '1764689806055-three_consecutive.jff',
      originalFileName: 'three_consecutive.jff',
      type: 'FA',
      maxStates: 4,
      isDeterministic: true,
      courseId: course2.id,
    },
  });

  // ===========================
  // Create Assignments
  // ===========================

  // Course 1
  const assignment1 = await prisma.assignment.upsert({
    where: { id: 'cmdnwyb8k0000lvjcjctu5em3' },
    update: {},
    create: {
      id: 'cmdnwyb8k0000lvjcjctu5em3',
      title: 'Flip Flops',
      description:
        'For this assignment, you will be creating finite automation machines for varying types of flip-flops.',
      dueDate: new Date('2025-09-29T03:59:00.000Z'),
      maxPoints: 20,
      isPublished: true,
      courseId: course1.id,
    },
  });

  const assignment2 = await prisma.assignment.upsert({
    where: { id: 'cmdp906y10001lviwgpo84uwd' },
    update: {},
    create: {
      id: 'cmdp906y10001lviwgpo84uwd',
      title: 'Real Life Examples',
      description: 'For this assignment, you will be creating finite automation machines solving real world problems.',
      dueDate: new Date('2025-11-30T03:59:00.000Z'),
      maxPoints: 20,
      isPublished: true,
      courseId: course1.id,
    },
  });

    // Course 2
  const assignment3 = await prisma.assignment.upsert({
    where: { id: 'cmdks90ng0001bw54k8yvo36s' },
    update: {},
    create: {
      id: 'cmdks90ng0001bw54k8yvo36s',
      title: 'Flip Flops',
      description:
        'For this assignment, you will be creating finite automation machines for varying types of flip-flops.',
      dueDate: new Date('2025-02-15T03:59:00.000Z'),
      maxPoints: 20,
      isPublished: true,
      courseId: course2.id,
    },
  });

  const assignment4 = await prisma.assignment.upsert({
    where: { id: 'cmdhz44xf0003lv28v5xro67q' },
    update: {},
    create: {
      id: 'cmdhz44xf0003lv28v5xro67q',
      title: 'Real Life Examples',
      description: 'For this assignment, you will be creating finite automation machines solving real world problems.',
      dueDate: new Date('2025-04-30T03:59:00.000Z'),
      maxPoints: 20,
      isPublished: true,
      courseId: course2.id,
    },
  });

  // ===========================
  // Link Problems to Assignments
  // ===========================

  // Course 1
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
        assignmentId: assignment1.id,
        problemId: problem2.id,
      },
    },
    update: {},
    create: {
      assignmentId: assignment1.id,
      problemId: problem2.id,
    },
  });

  await prisma.assignmentProblem.upsert({
    where: {
      assignmentId_problemId: {
        assignmentId: assignment2.id,
        problemId: problem3.id,
      },
    },
    update: {},
    create: {
      assignmentId: assignment2.id,
      problemId: problem3.id,
    },
  });

  await prisma.assignmentProblem.upsert({
    where: {
      assignmentId_problemId: {
        assignmentId: assignment2.id,
        problemId: problem4.id,
      },
    },
    update: {},
    create: {
      assignmentId: assignment2.id,
      problemId: problem4.id,
    },
  });

  // Course 2
  await prisma.assignmentProblem.upsert({
    where: {
      assignmentId_problemId: {
        assignmentId: assignment3.id,
        problemId: problem5.id,
      },
    },
    update: {},
    create: {
      assignmentId: assignment3.id,
      problemId: problem5.id,
    },
  });

  await prisma.assignmentProblem.upsert({
    where: {
      assignmentId_problemId: {
        assignmentId: assignment3.id,
        problemId: problem6.id,
      },
    },
    update: {},
    create: {
      assignmentId: assignment3.id,
      problemId: problem6.id,
    },
  });

  await prisma.assignmentProblem.upsert({
    where: {
      assignmentId_problemId: {
        assignmentId: assignment4.id,
        problemId: problem7.id,
      },
    },
    update: {},
    create: {
      assignmentId: assignment4.id,
      problemId: problem7.id,
    },
  });

  await prisma.assignmentProblem.upsert({
    where: {
      assignmentId_problemId: {
        assignmentId: assignment4.id,
        problemId: problem8.id,
      },
    },
    update: {},
    create: {
      assignmentId: assignment4.id,
      problemId: problem8.id,
    },
  });

  // Count entities for scalable logging
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

  console.log('Database seeded successfully!');
  console.log('Created:');
  console.log(`- ${adminCount} Admin user(s)`);
  console.log(`- ${facultyCount} Faculty user(s)`);
  console.log(`- ${taCount} TA user(s)`);
  console.log(`- ${studentCount} Student user(s)`);
  console.log(`- ${userCount} Total user(s)`);
  console.log(`- ${courseCount} Course(s)`);
  console.log(`- ${problemCount} Problem(s)`);
  console.log(`- ${assignmentCount} Assignment(s)`);
  console.log(`- ${rosterCount} Course roster membership(s)`);
  console.log(`- ${assignmentProblemCount} Assignment-Problem linkage(s)`);
  console.log(`- ${commentCount} Comment(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
