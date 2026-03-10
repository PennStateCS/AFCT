import { Course, User, Assignment, Problem, Role } from '@prisma/client';

// Assignment with problem count as returned by API. `maxPoints` is not stored on
// the assignment record any more; consumers are expected to fetch it separately
// from /api/assignments/:id (it is calculated by summing the problem maxPoints).
export type AssignmentWithProblemCount = Assignment & {
  problemCount: number;
  maxPoints?: number;
  hasSubmissionsOrComments?: boolean;
  submissionCount?: number;
  commentCount?: number;
};

export type FullCourse = Course & {
  // enrolled is a list of course members as User objects augmented with their course role and flags
  enrolled?: (User & { courseRole?: string; hasSubmissions?: boolean })[];
  assignments: AssignmentWithProblemCount[];
  problems: Problem[];
  // viewer's role in this course (ADMIN | FACULTY | TA | STUDENT) or null
  viewerRole?: string | null;
  // viewer's global default role (ADMIN | FACULTY | TA | STUDENT) or null
  viewerDefaultRole?: string | null;
};

export type DeleteTarget = {
  id: string;
  type: 'problem' | 'assignment';
};

export type EnrollableUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: Role;
};

export type TabType = 'assignments' | 'problems' | 'roster' | 'grades' | 'activity';
