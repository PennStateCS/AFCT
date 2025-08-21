import { FullCourse, DeleteTarget } from '@/types/course';
import { Assignment, Problem, Course } from '@prisma/client';

export async function deleteItem(target: DeleteTarget): Promise<void> {
  if (target.type === 'assignment') {
    const res = await fetch(`/api/assignments/${target.id}`, { method: 'DELETE' });
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
    const res = await fetch(`/api/problems/${target.id}`, { method: 'DELETE' });
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

export function updateCourseAfterDelete(
  course: FullCourse,
  target: DeleteTarget
): FullCourse {
  if (target.type === 'assignment') {
    return {
      ...course,
      assignments: course.assignments.filter((a) => a.id !== target.id)
    };
  } else if (target.type === 'problem') {
    return {
      ...course,
      problems: course.problems.filter((p) => p.id !== target.id)
    };
  }
  return course;
}

export function updateCourseAfterAssignmentSave(
  course: FullCourse,
  updatedAssignment: Assignment
): FullCourse {
  return {
    ...course,
    assignments: course.assignments.map((a) =>
      a.id === updatedAssignment.id
        ? { ...updatedAssignment, problemCount: a.problemCount }
        : a
    ),
  };
}

export function updateCourseAfterAssignmentPublish(
  course: FullCourse,
  assignmentId: string,
  isPublished: boolean
): FullCourse {
  return {
    ...course,
    assignments: course.assignments.map((a) =>
      a.id === assignmentId ? { ...a, isPublished } : a
    ),
  };
}

export function updateCourseAfterProblemSave(
  course: FullCourse,
  updatedProblem: Problem
): FullCourse {
  return {
    ...course,
    problems: course.problems.map((p) => (p.id === updatedProblem.id ? updatedProblem : p)),
  };
}

export function updateCourseAfterAssignmentCreate(
  course: FullCourse,
  newAssignment: Assignment
): FullCourse {
  return {
    ...course,
    assignments: [...course.assignments, { ...newAssignment, problemCount: 0 }],
  };
}

export function updateCourseAfterProblemCreate(
  course: FullCourse,
  newProblem: Problem
): FullCourse {
  return {
    ...course,
    problems: [...course.problems, newProblem],
  };
}

export async function updateAssignmentPublishStatus(
  assignmentId: string,
  isPublished: boolean
): Promise<void> {
  const res = await fetch(`/api/assignments/${assignmentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPublished }),
  });
  
  if (!res.ok) throw new Error('Failed to update assignment');
}

export async function updateCoursePublishStatus(
  courseId: string,
  isPublished: boolean
): Promise<Course> {
  const res = await fetch(`/api/courses/${courseId}/publish`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPublished }),
  });
  
  if (!res.ok) throw new Error('Failed to update publish status');
  return res.json();
}

export async function saveCourse(course: Course): Promise<Course> {
  const res = await fetch(`/api/courses/${course.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(course),
  });
  
  if (!res.ok) throw new Error('Failed to save course');
  return res.json();
}
