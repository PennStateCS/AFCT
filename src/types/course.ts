import { Course, User, Assignment, Problem, Role } from '@prisma/client';

// Assignment with problem count as returned by API
export type AssignmentWithProblemCount = Assignment & {
  problemCount: number;
};

export type FullCourse = Course & {
  // enrolled is a list of course members as User objects augmented with their course role and flags
  enrolled?: (User & { courseRole?: string; hasSubmissions?: boolean })[];
  assignments: AssignmentWithProblemCount[];
  problems: Problem[];
  // viewer's role in this course (INSTRUCTOR | FACULTY | TA | STUDENT) or null
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
