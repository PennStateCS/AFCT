import { prisma } from '@/lib/prisma';
import { Submission, User, AssignmentProblem } from '@prisma/client';

export type SubmissionWithRelations = Submission & {
  student: Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;
  assignmentProblem: AssignmentProblem;
};

export async function getSubmissionById(id: string): Promise<SubmissionWithRelations | null> {
  try {
    return await prisma.submission.findUnique({
      where: { id },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        assignmentProblem: true,
      },
    });
  } catch (error) {
    console.error('Error fetching submission:', error);
    return null;
  }
}

export async function getSubmissionsByAssignment(
  assignmentId: string,
): Promise<SubmissionWithRelations[]> {
  try {
    return await prisma.submission.findMany({
      where: { assignmentId },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        assignmentProblem: true,
      },
      orderBy: { submittedAt: 'desc' },
    });
  } catch (error) {
    console.error('Error fetching submissions by assignment:', error);
    return [];
  }
}

export async function getSubmissionsByStudent(
  studentId: string,
): Promise<SubmissionWithRelations[]> {
  try {
    return await prisma.submission.findMany({
      where: { studentId },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        assignmentProblem: true,
      },
      orderBy: { submittedAt: 'desc' },
    });
  } catch (error) {
    console.error('Error fetching submissions by student:', error);
    return [];
  }
}

export async function getSubmissionsByAssignmentAndProblem(
  assignmentId: string,
  problemId: string,
): Promise<SubmissionWithRelations[]> {
  try {
    return await prisma.submission.findMany({
      where: {
        assignmentId,
        problemId,
      },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        assignmentProblem: true,
      },
      orderBy: { submittedAt: 'desc' },
    });
  } catch (error) {
    console.error('Error fetching submissions by assignment and problem:', error);
    return [];
  }
}

export async function createSubmission(data: {
  studentId: string;
  assignmentId: string;
  problemId: string;
  fileName?: string;
  originalFileName?: string;
}): Promise<Submission | null> {
  try {
    return await prisma.submission.create({
      data: {
        studentId: data.studentId,
        assignmentId: data.assignmentId,
        problemId: data.problemId,
        fileName: data.fileName,
        originalFileName: data.originalFileName,
      },
    });
  } catch (error) {
    console.error('Error creating submission:', error);
    return null;
  }
}

export async function updateSubmission(
  id: string,
  data: {
    feedback?: string;
    correct?: boolean;
  },
): Promise<Submission | null> {
  try {
    return await prisma.submission.update({
      where: { id },
      data,
    });
  } catch (error) {
    console.error('Error updating submission:', error);
    return null;
  }
}

export async function deleteSubmission(id: string): Promise<boolean> {
  try {
    await prisma.submission.delete({
      where: { id },
    });
    return true;
  } catch (error) {
    console.error('Error deleting submission:', error);
    return false;
  }
}

export async function getStudentSubmissionForProblem(
  studentId: string,
  assignmentId: string,
  problemId: string,
): Promise<SubmissionWithRelations | null> {
  try {
    return await prisma.submission.findFirst({
      where: {
        studentId,
        assignmentId,
        problemId,
      },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        assignmentProblem: true,
      },
      orderBy: { submittedAt: 'desc' },
    });
  } catch (error) {
    console.error('Error fetching student submission for problem:', error);
    return null;
  }
}
