import { Problem, Role } from '@prisma/client';

export type AssignmentProblemLink = {
  problem: Problem;
  maxPoints: number;
  maxSubmissions: number;
  autograderEnabled: boolean;
};

export type AssignmentCourseSummary = {
  id: string;
  name: string;
  code?: string;
  isArchived?: boolean;
  roster?: Array<{
    role: Role | null;
    user: {
      id: string;
      firstName: string | null;
      lastName: string | null;
    };
  }>;
};

export type AssignmentWithDetails = {
  id: string;
  title: string;
  description?: string | null;
  courseId: string;
  courseName?: string;
  courseCode?: string;
  courseIsArchived?: boolean;
  dueDate: string | Date;
  maxPoints: number;
  allowLateSubmissions?: boolean;
  lateCutoff?: string | Date | null;
  isPublished: boolean;
  isGroup?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  problems: AssignmentProblemLink[];
  course?: AssignmentCourseSummary;
};

export type StudentProblemSubmission = {
  id: string;
  submittedAt: string;
  grade: number | null;
  feedback: string | null;
  problemId: string;
  status: 'SUBMITTED' | 'GRADED' | 'LATE';
  fileName?: string | null;
  originalFileName?: string | null;
  correct?: boolean | null;
};

export type StudentProblemComment = {
  id: string;
  content: string;
  createdAt: string;
  authorId?: string | null;
  authorName: string;
  authorRole: Role;
  problemId: string;
};

export type StudentAssignmentContext = {
  assignmentGrade: number | null;
  submissionCount: number;
  submissionsByProblem: Record<string, StudentProblemSubmission[]>;
  commentsByProblem: Record<string, StudentProblemComment[]>;
};
