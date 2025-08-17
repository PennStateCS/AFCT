// Temporary file to test Prisma types
import { prisma } from '@/lib/prisma';

// This should work if the new fields are properly generated
async function testTypes() {
  const activities = await prisma.activityLog.findMany({
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
  
  return activities;
}
