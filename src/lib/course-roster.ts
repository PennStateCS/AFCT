// Reading a course roster: the shape the UI receives for an enrolled member, and the
// role slicing, counting, and sorting built on it. Pure and free of fetch, so it is safe
// to use anywhere the roster is already loaded.

import { roleOrder } from '@/lib/roles';

export type EnrolledUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatar?: string | null;
  role?: string; // global role
  courseRole?: string; // course-specific role
  // Enrollment standing for a student (ENROLLED / DROPPED). Present on the staff roster
  // view so the table can badge dropped students; undefined for staff rows and the
  // privacy-safe student view.
  enrollmentStatus?: string;
  hasSubmissions?: boolean;
};

export function getEnrolledIds(enrolled: (string | EnrolledUser)[] | undefined): string[] {
  if (!enrolled) return [];
  return enrolled.map((e) => (typeof e === 'string' ? e : e.id));
}

// No `isEnrolled` here on purpose. Membership in this array is a display fact, not an
// access decision, and a helper of that name invites being used as one. Authorization
// goes through `canAccessCourse` / `canManageCourse` in `lib/permissions`.

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
