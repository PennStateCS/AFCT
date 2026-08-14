/**
 * What the submissions page asks the server for, and the shapes it gets back.
 *
 * Kept apart from the component because none of it is React: these are plain async functions
 * over `fetch`, and the two formatters below are pure. In the component they could only be
 * exercised by rendering the whole page, which is why the error branches here (a course list
 * that fails, an assignment list that 404s) had no coverage at all.
 */

import type { Course } from '@prisma/client';
import { apiPaths } from '@/lib/api-paths';
import type { SubmissionStatusFilter } from '@/lib/submission-status-filter';

export type CourseItem = Pick<Course, 'id' | 'name' | 'code'>;

export type AssignmentItem = {
  id: string;
  title: string;
  dueDate?: string;
  courseId: string;
  problems: string[];
};

export type ProblemItem = {
  id: string;
  title: string;
  description: string | null;
  type: string | null;
  maxPoints: number | null;
  maxStates: number | null;
  isDeterministic: boolean | null;
  solved: boolean;
  grade: number | null;
};

// Shape returned by POST /api/admin/submissions (one page of rows). `dueDate` and
// `problemType` come from the server so a row is self-describing: the table no longer has
// to look its assignment or problem up in the picker lists, which held only the current
// selection and quietly returned nothing for anything outside it.
export type SubmissionItem = {
  id: string;
  /** False when the problem is hand-graded, so there is no queue state to report. */
  autograderEnabled: boolean;
  /** True when the assignment is group work. */
  isGroupAssignment: boolean;
  studentId: string;
  courseId: string;
  assignmentId: string;
  problemId: string;
  studentFirstName?: string | null;
  studentLastName?: string | null;
  studentEmail: string;
  courseName: string;
  assignmentTitle: string;
  dueDate: string;
  problemType: string | null;
  submittedAt: string;
  status: SubmissionStatusFilter;
  grade?: number | null;
  correct?: boolean | null;
  maxPoints?: number | null;
  problemTitle?: string | null;
  fileName?: string | null;
  originalFileName?: string | null;
  feedback: string | null;
};

/** The server-side query: sent as the request body and used as the react-query key. */
export type SubmissionsQuery = {
  courseIds: string[];
  assignmentIds: string[];
  problemIds: string[];
  q?: string;
  field: string;
  timing: string[];
  status: string[];
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
};

/**
 * "Lastname, Firstname" for a submission's student, or null when neither is recorded.
 *
 * Sorted-by-surname order, because that is how a roster reads and how staff look someone
 * up. One name alone is returned on its own rather than left with a dangling comma.
 */
export function formatStudentName(submission: {
  studentFirstName?: string | null;
  studentLastName?: string | null;
}): string | null {
  const first = submission.studentFirstName?.trim();
  const last = submission.studentLastName?.trim();
  if (last && first) return `${last}, ${first}`;
  return last || first || null;
}

/**
 * Points this one attempt earned, or null while it has no result.
 *
 * Mirrors what the submission worker writes when it grades: a correct attempt earns the
 * problem's full points and an incorrect one earns zero. Kept in step with
 * `submission-worker.ts` if that ever stops being all-or-nothing.
 */
export function attemptPointsFor(submission: SubmissionItem): number | null {
  if (submission.correct == null) return null;
  return submission.correct ? (submission.maxPoints ?? 0) : 0;
}

/**
 * The courses this viewer may look at.
 *
 * Throws rather than returning empty, because an admin who cannot see their course list is
 * looking at a broken page, not an empty one. The lists below take the opposite view.
 */
export const fetchCourseList = async (): Promise<CourseItem[]> => {
  const response = await fetch(apiPaths.myCourses());
  if (!response.ok) {
    throw new Error('Failed to load courses');
  }
  return (await response.json()) as CourseItem[];
};

/**
 * Assignments in one course, for the filter list.
 *
 * An empty list on failure: one course the viewer cannot read should narrow the picker, not
 * break the whole cascade for the courses that did answer.
 */
export const fetchAssignmentsForCourse = async (courseId: string): Promise<AssignmentItem[]> => {
  const response = await fetch(apiPaths.courseAssignments(courseId));
  if (!response.ok) return [];

  const assignments = (await response.json()) as Array<{
    id: string;
    title: string;
    dueDate?: string;
    problems?: Array<{
      problemId: string;
      maxPoints: number;
    }>;
  }>;

  return assignments.map((assignment) => {
    const problems = Array.isArray(assignment.problems) ? assignment.problems : [];
    return {
      id: assignment.id,
      title: assignment.title,
      dueDate: assignment.dueDate,
      courseId,
      problems: problems.map((problem) => problem.problemId),
    };
  });
};

/** Problems on one assignment, for the filter list. Empty on failure, as above. */
export const fetchProblemsForAssignment = async (assignmentId: string): Promise<ProblemItem[]> => {
  const response = await fetch(apiPaths.assignmentByIdProblems(assignmentId));

  if (!response.ok) {
    return [];
  }

  const problems = (await response.json()) as Array<{
    id: string;
    title: string;
    description: string | null;
    type: string | null;
    maxPoints: number | null;
    maxStates: number | null;
    isDeterministic: boolean | null;
    solved: boolean;
    grade: number | null;
  }>;

  return problems.map((problem) => ({
    id: problem.id,
    title: problem.title,
    description: problem.description,
    type: problem.type,
    maxPoints: problem.maxPoints,
    maxStates: problem.maxStates,
    isDeterministic: problem.isDeterministic,
    solved: problem.solved,
    grade: problem.grade,
  }));
};

export const fetchSubmissions = async (
  query: SubmissionsQuery,
): Promise<{ rows: SubmissionItem[]; total: number }> => {
  const response = await fetch(apiPaths.admin.submissions(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(query),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to load submissions');
  }

  return (await response.json()) as { rows: SubmissionItem[]; total: number };
};

// Fan out across the selected courses / assignments for the filter lists.
export const fetchAssignmentsForCourses = async (courseIds: string[]): Promise<AssignmentItem[]> => {
  const rows = await Promise.all(courseIds.map((id) => fetchAssignmentsForCourse(id)));
  return rows.flat();
};

export const fetchProblemsForAssignments = async (
  assignmentIds: string[],
): Promise<ProblemItem[]> => {
  const rows = await Promise.all(assignmentIds.map((id) => fetchProblemsForAssignment(id)));
  const flat = rows.flat();
  // Dedupe: the same problem can be attached to more than one assignment.
  return Array.from(new Map(flat.map((problem) => [problem.id, problem])).values());
};
