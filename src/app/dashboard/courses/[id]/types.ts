import { Course, User, Assignment, Problem, Role } from '@prisma/client';

// Assignment with problem count as returned by API
export type AssignmentWithProblemCount = Assignment & {
  problemCount: number;
};

export type FullCourse = Course & {
  faculty: User[];
  tas: User[];
  students: User[];
  assignments: AssignmentWithProblemCount[];
  problems: Problem[];
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
