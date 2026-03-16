import { Course, Assignment, Problem, Role } from '@prisma/client';

// Assignment with problem count as returned by API
export type AssignmentWithProblemCount = Assignment & {
  problemCount: number;
  maxPoints: number;
  hasSubmissionsOrComments?: boolean;
  submissionCount?: number;
  commentCount?: number;
};

export type FullCourse = Course & {
  // enrolled is a list of course members as User objects augmented with their course role and flags
  enrolled?: Array<{
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    avatar?: string | null;
    role?: string;
    courseRole?: string;
    hasSubmissions?: boolean;
  }>;
  assignments: AssignmentWithProblemCount[];
  problems: Problem[];
  assignmentTotal?: number;
  problemTotal?: number;
  rosterTotal?: number;
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

export type TabType = 'assignments' | 'problems' | 'roster' | 'grades' | 'groups' | 'activity';
