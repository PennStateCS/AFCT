// Test file to verify Prisma types are working
import { prisma } from '@/lib/prisma';

async function testActivityLogTypes() {
  // This should compile without errors if the types are correct
  const result = await prisma.activityLog.findMany({
    where: {
      courseId: 'test',
      assignmentId: 'test',
      problemId: 'test', 
      submissionId: 'test',
      category: 'SYSTEM',
    },
    include: {
      course: true,
      assignment: true,
      problem: true,
      submission: true,
    },
  });
  
  return result;
}

export default testActivityLogTypes;
