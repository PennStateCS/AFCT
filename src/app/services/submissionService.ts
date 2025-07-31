import { prisma } from '@/lib/prisma';

export type CreateSubmissionInput = {
  userId: string;
  assignmentId: string;
  problemId: string;
  content: string;
};

/**
 * Create a new submission for a problem within an assignment.
 */
export async function createSubmission(data: CreateSubmissionInput) {
  // Get the next attempt number for this user/problem
  const last = await prisma.submission.findFirst({
    where: {
      userId: data.userId,
      assignmentId: data.assignmentId,
      problemId: data.problemId,
    },
    orderBy: { attempt: 'desc' },
  });

  const attempt = last ? last.attempt + 1 : 1;

  return prisma.submission.create({
    data: {
      content: data.content,
      assignmentId: data.assignmentId,
      problemId: data.problemId,
      userId: data.userId,
      attempt,
    },
    select: {
      id: true,
      content: true,
      attempt: true,
      submittedAt: true,
      grade: true,
      feedback: true,
    },
  });
}

/**
 * Get all submissions for a student for a specific assignment.
 */
export async function getSubmissionsForAssignment(userId: string, assignmentId: string) {
  const submissions = await prisma.submission.findMany({
    where: {
      userId,
      assignmentId,
    },
    orderBy: [{ problemId: 'asc' }, { attempt: 'asc' }],
    select: {
      id: true,
      content: true,
      attempt: true,
      submittedAt: true,
      grade: true,
      feedback: true,
      problemId: true,
    },
  });

  // Group by problemId into a dictionary { problemId: Submission[] }
  return submissions.reduce<Record<string, typeof submissions>>((acc, s) => {
    if (!acc[s.problemId]) acc[s.problemId] = [];
    acc[s.problemId].push(s);
    return acc;
  }, {});
}

/**
 * Get all submissions for a specific problem for a student.
 */
export async function getSubmissionsForProblem(
  userId: string,
  assignmentId: string,
  problemId: string,
) {
  return prisma.submission.findMany({
    where: {
      userId,
      assignmentId,
      problemId,
    },
    orderBy: { attempt: 'asc' },
    select: {
      id: true,
      content: true,
      attempt: true,
      submittedAt: true,
      grade: true,
      feedback: true,
    },
  });
}
