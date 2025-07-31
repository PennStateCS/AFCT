// prisma/seed.ts
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('password123', 10);

  // Sample names
  const facultyNames = [
    ['Alice', 'Johnson'],
    ['Bob', 'Smith'],
    ['Carol', 'Davis'],
  ];

  const taNames = [
    ['Dave', 'Miller'],
    ['Eve', 'Anderson'],
    ['Frank', 'Brown'],
  ];

  const studentNames = Array.from({ length: 30 }, (_, i) => [`Student${i + 1}`, `Last${i + 1}`]);

  // Create core users
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      password: hashedPassword,
      role: Role.ADMIN,
    },
  });

  const faculty = await Promise.all(
    facultyNames.map(([first, last], i) =>
      prisma.user.upsert({
        where: { email: `faculty${i}@example.com` },
        update: {},
        create: {
          email: `faculty${i}@example.com`,
          firstName: first,
          lastName: last,
          password: hashedPassword,
          role: Role.FACULTY,
        },
      })
    )
  );

  const tas = await Promise.all(
    taNames.map(([first, last], i) =>
      prisma.user.upsert({
        where: { email: `ta${i}@example.com` },
        update: {},
        create: {
          email: `ta${i}@example.com`,
          firstName: first,
          lastName: last,
          password: hashedPassword,
          role: Role.TA,
        },
      })
    )
  );

  const students = await Promise.all(
    studentNames.map(([first, last], i) =>
      prisma.user.upsert({
        where: { email: `student${i + 1}@example.com` },
        update: {},
        create: {
          email: `student${i + 1}@example.com`,
          firstName: first,
          lastName: last,
          password: hashedPassword,
          role: Role.STUDENT,
        },
      })
    )
  );

  const courses = await Promise.all(
    Array.from({ length: 5 }).map(async (_, i) => {
      const shuffledStudents = [...students].sort(() => 0.5 - Math.random()).slice(0, 10);
      const facultyMember = faculty[i % faculty.length];
      const taMember = tas[i % tas.length];

      const course = await prisma.course.create({
        data: {
          name: `Course ${i + 1}`,
          code: `CSCI10${i}`,
          semester: i % 2 === 0 ? 'Fall 2025' : 'Spring 2026',
          credits: 3 + (i % 2),
          startDate: new Date(2025, i % 2 === 0 ? 7 : 0, 15),
          endDate: new Date(2025, i % 2 === 0 ? 11 : 4, 15),
          isPublished: i % 2 === 0,
          faculty: { connect: { id: facultyMember.id } },
          tas: { connect: [{ id: taMember.id }] },
          students: {
            connect: shuffledStudents.map((s) => ({ id: s.id })),
          },
        },
      });

      // Add assignments and problems to some courses
      const addAssignments = i % 2 === 0;
      if (addAssignments) {
        const assignments = await Promise.all(
          Array.from({ length: 2 }).map((_, j) =>
            prisma.assignment.create({
              data: {
                title: `Assignment ${j + 1} - ${course.name}`,
                description: `Description for Assignment ${j + 1}`,
                dueDate: new Date(2025, (i % 2 === 0 ? 9 : 3), 1 + j * 7),
                maxPoints: 100,
                isPublished: j % 2 === 0,
                courseId: course.id,
              },
            })
          )
        );

        const problems = await Promise.all(
          Array.from({ length: 3 }).map((_, k) =>
            prisma.problem.create({
              data: {
                title: `Problem ${k + 1} - ${course.name}`,
                description: `Problem ${k + 1} details`,
                difficulty: 1 + (k % 3),
                courseId: course.id,
              },
            })
          )
        );

        // Simulate linking some problems to multiple assignments
        for (const a of assignments) {
          await prisma.submission.create({
            data: {
              assignmentId: a.id,
              studentId: shuffledStudents[0].id,
              content: "Sample submission",
              grade: 90,
              feedback: "Good job!",
            },
          });
        }
      }

      return course;
    })
  );

  console.log({
    admin,
    faculty: faculty.length,
    tas: tas.length,
    students: students.length,
    courses: courses.length,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
