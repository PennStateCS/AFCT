const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

async function extractData() {
  try {
    console.log('Extracting data from database...');

    // Extract all data
    const users = await prisma.user.findMany({
      include: {
        rosterEntries: true,
      },
    });

    const courses = await prisma.course.findMany({
      include: {
        roster: {
          include: {
            user: true,
          },
        },
        assignments: {
          include: {
            problems: {
              include: {
                problem: true,
              },
            },
          },
        },
      },
    });

    const problems = await prisma.problem.findMany();

    const assignments = await prisma.assignment.findMany({
      include: {
        problems: {
          include: {
            problem: true,
          },
        },
      },
    });

    const roster = await prisma.roster.findMany({
      include: {
        user: true,
        course: true,
      },
    });

    const submissions = await prisma.submission.findMany();

    const data = {
      users,
      courses,
      problems,
      assignments,
      roster,
      submissions,
      userCount: users.length,
      courseCount: courses.length,
      problemCount: problems.length,
      assignmentCount: assignments.length,
    };

    // Write to file
    fs.writeFileSync('database-export.json', JSON.stringify(data, null, 2));

    console.log(`Extracted data:`);
    console.log(`- ${data.userCount} users`);
    console.log(`- ${data.courseCount} courses`);
    console.log(`- ${data.problemCount} problems`);
    console.log(`- ${data.assignmentCount} assignments`);
    console.log(`- ${data.roster.length} roster entries`);
    console.log(`- ${data.submissions.length} submissions`);

    console.log('Data exported to database-export.json');
  } catch (error) {
    console.error('Error extracting data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

extractData();
