import type { FullCourse, DeleteTarget } from '@/types/course';
import type { Assignment, Problem, Course } from '@prisma/client';
import { apiPaths } from '@/lib/api-paths';

export async function deleteItem(target: DeleteTarget, courseId: string): Promise<void> {
  if (target.type === 'assignment') {
    const res = await fetch(apiPaths.assignment(courseId, target.id), { method: 'DELETE' });
    if (!res.ok) {
      let msg = 'Failed to delete assignment';
      try {
        const body = await res.json();
        msg = body?.error || body?.message || msg;
      } catch {
        // ignore JSON parse errors
      }
      throw new Error(msg);
    }
  } else if (target.type === 'problem') {
    const res = await fetch(apiPaths.courseProblem(courseId, target.id), { method: 'DELETE' });
    if (!res.ok) {
      let msg = 'Failed to delete problem';
      try {
        const body = await res.json();
        msg = body?.error || body?.message || msg;
      } catch {
        // ignore JSON parse errors
      }
      throw new Error(msg);
    }
  }
}

export function updateCourseAfterDelete(course: FullCourse, target: DeleteTarget): FullCourse {
  if (target.type === 'assignment') {
    return {
      ...course,
      assignments: course.assignments.filter((a) => a.id !== target.id),
    };
  } else if (target.type === 'problem') {
    return {
      ...course,
      problems: course.problems.filter((p) => p.id !== target.id),
    };
  }
  return course;
}

export function updateCourseAfterAssignmentSave(
  course: FullCourse,
  updatedAssignment: Assignment,
): FullCourse {
  return {
    ...course,
    assignments: course.assignments.map((a) =>
      a.id === updatedAssignment.id ? { ...a, ...updatedAssignment } : a,
    ),
  };
}

export function updateCourseAfterAssignmentPublish(
  course: FullCourse,
  assignmentId: string,
  isPublished: boolean,
): FullCourse {
  return {
    ...course,
    assignments: course.assignments.map((a) => (a.id === assignmentId ? { ...a, isPublished } : a)),
  };
}

export function updateCourseAfterProblemSave(
  course: FullCourse,
  updatedProblem: Problem,
): FullCourse {
  return {
    ...course,
    problems: course.problems.map((p) => (p.id === updatedProblem.id ? updatedProblem : p)),
  };
}

export function updateCourseAfterAssignmentCreate(
  course: FullCourse,
  newAssignment: Assignment,
): FullCourse {
  return {
    ...course,
    assignments: [
      ...course.assignments,
      {
        ...newAssignment,
        problemCount: 0,
        maxPoints: 0,
        submissionCount: 0,
        commentCount: 0,
        hasSubmissionsOrComments: false,
      },
    ],
  };
}

export function updateCourseAfterProblemCreate(
  course: FullCourse,
  newProblem: Problem,
): FullCourse {
  return {
    ...course,
    problems: [...course.problems, newProblem],
  };
}

export async function updateAssignmentPublishStatus(
  courseId: string,
  assignmentId: string,
  isPublished: boolean,
): Promise<void> {
  const res = await fetch(apiPaths.assignment(courseId, assignmentId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPublished }),
  });

  if (!res.ok) {
    let msg = 'Failed to publish course';
    try {
      const body = await res.json();
      msg = body?.error || body?.message || msg;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(msg);
  }
  return res.json();
}

export async function updateCoursePublishStatus(
  courseId: string,
  isPublished: boolean,
): Promise<Course> {
  const res = await fetch(apiPaths.coursePublish(courseId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPublished }),
  });

  if (!res.ok) {
    let msg = 'Failed to publish course';
    try {
      const body = await res.json();
      msg = body?.error || body?.message || msg;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(msg);
  }
  return res.json();
}

export async function updateCourseArchiveStatus(
  courseId: string,
  startDate: Date,
  endDate: Date,
  isArchived: boolean,
): Promise<Course> {
  const res = await fetch(apiPaths.courseArchive(courseId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isArchived: isArchived, startDate: startDate, endDate: endDate }),
  });

  if (!res.ok) {
    let msg = 'Failed to archive course';
    try {
      const body = await res.json();
      msg = body?.error || body?.message || msg;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(msg);
  }
  return res.json();
}

export async function saveCourse(course: Course): Promise<Course> {
  const res = await fetch(apiPaths.course(course.id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(course),
  });

  if (!res.ok) throw new Error('Failed to save course');
  return res.json();
}

// -------------------------
// Enrolled / roster helpers
// -------------------------
import { roleOrder } from '@/lib/roles';

export type EnrolledUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatar?: string | null;
  role?: string; // global role
  courseRole?: string; // course-specific role
  hasSubmissions?: boolean;
};

export function getEnrolledIds(enrolled: (string | EnrolledUser)[] | undefined): string[] {
  if (!enrolled) return [];
  return enrolled.map((e) => (typeof e === 'string' ? e : e.id));
}

export function isEnrolled(
  enrolled: (string | EnrolledUser)[] | undefined,
  userId: string,
): boolean {
  const ids = getEnrolledIds(enrolled);
  return ids.includes(userId);
}

export function getInstructors(enrolled: EnrolledUser[] | undefined): EnrolledUser[] {
  if (!Array.isArray(enrolled)) return [];
  return enrolled.filter((u) => u.courseRole === 'FACULTY');
}

export function getTAs(enrolled: EnrolledUser[] | undefined): EnrolledUser[] {
  if (!Array.isArray(enrolled)) return [];
  return enrolled.filter((u) => u.courseRole === 'TA');
}

export function getStudents(enrolled: EnrolledUser[] | undefined): EnrolledUser[] {
  if (!Array.isArray(enrolled)) return [];
  return enrolled.filter((u) => u.courseRole === 'STUDENT');
}

export function getStudentCount(enrolled: EnrolledUser[] | undefined): number {
  return getStudents(enrolled).length;
}

export function formatInstructorNames(enrolled: EnrolledUser[] | undefined): string {
  const instructors = getInstructors(enrolled);
  if (instructors.length === 0) return 'TBA';
  return instructors
    .map((instructor) => `${instructor.firstName ?? ''} ${instructor.lastName ?? ''}`.trim())
    .filter(Boolean)
    .join(', ');
}

export function deriveRoleSlices(enrolled: EnrolledUser[] | undefined) {
  const instructors = getInstructors(enrolled);
  const tas = getTAs(enrolled);
  const students = getStudents(enrolled);
  return {
    instructors,
    tas,
    students,
    counts: { instructors: instructors.length, tas: tas.length, students: students.length },
  };
}

// Return a sorted roster array (shallow copies) based on courseRole ordering and last name
export function sortRoster(enrolled: EnrolledUser[] | undefined): EnrolledUser[] {
  if (!Array.isArray(enrolled)) return [];
  // Build a role priority using roleOrder but favor courseRole when present
  return enrolled.slice().sort((a, b) => {
    const aRole = (a.courseRole ?? '').toUpperCase();
    const bRole = (b.courseRole ?? '').toUpperCase();
    const diff = (roleOrder[aRole] ?? 99) - (roleOrder[bRole] ?? 99);
    if (diff !== 0) return diff;
    const aLast = (a.lastName || '').toLowerCase();
    const bLast = (b.lastName || '').toLowerCase();
    if (aLast < bLast) return -1;
    if (aLast > bLast) return 1;
    return 0;
  });
}
