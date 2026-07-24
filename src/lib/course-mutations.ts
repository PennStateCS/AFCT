// Client-side course mutations and the optimistic local-state updates that follow them.
// Each `updateCourseAfter*` returns a new FullCourse rather than mutating, so the caller
// can hand it straight to setState. Consumed by `course-handlers.ts`.

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
        isGroup: newAssignment.groupSetId != null,
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
