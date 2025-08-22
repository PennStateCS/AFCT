const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testCreateGrade() {
  try {
    console.log('Testing grade system...');
    
    // First, check if there are existing grades
    const count = await prisma.assignmentGrade.count();
    console.log('Total grades in database:', count);
    
    // List all grades for verification
    const allGrades = await prisma.assignmentGrade.findMany({
      include: {
        assignment: { select: { title: true } },
        student: { select: { firstName: true, lastName: true } }
      }
    });
    
    console.log('All grades:');
    allGrades.forEach(g => {
      console.log(`- ${g.student.firstName} ${g.student.lastName}: ${g.grade} for ${g.assignment.title}`);
    });
    
    // Try to find grades for specific course
    const courseGrades = await prisma.assignmentGrade.findMany({
      where: {
        assignment: {
          courseId: 'cmdnw26cf0000lv14s4q5v73b'
        }
      },
      include: {
        assignment: { select: { title: true } },
        student: { select: { firstName: true, lastName: true } }
      }
    });
    
    console.log(`\nGrades for target course: ${courseGrades.length}`);
    courseGrades.forEach(g => {
      console.log(`- ${g.student.firstName} ${g.student.lastName}: ${g.grade} for ${g.assignment.title}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testCreateGrade();
