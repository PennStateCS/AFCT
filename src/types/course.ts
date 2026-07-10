import type { Course, Assignment, Problem } from '@prisma/client';

// Assignment with problem count as returned by API. `maxPoints` is not stored on
// the assignment record any more; consumers are expected to fetch it separately
// from /api/assignments/:id (it is calculated by summing the problem maxPoints).
export type AssignmentWithProblemCount = Assignment & {
  problemCount: number;
  maxPoints?: number;
  allowLateSubmissions?: boolean;
  lateCutoff?: string | Date | null;
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
  // whether the viewer is a global site admin
  viewerIsAdmin?: boolean;
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
};

export type TabType =
  | 'assignments'
  | 'problems'
  | 'roster'
  | 'grades'
  | 'groups'
  | 'activity'
  | 'settings';
