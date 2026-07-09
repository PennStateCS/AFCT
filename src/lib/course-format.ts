/**
 * Small pure helpers for shaping course/assignment API responses, extracted from the
 * handlers that repeated them verbatim.
 */

/**
 * Sums the per-problem `maxPoints` of an assignment's problem links into the
 * assignment's total points, treating missing/non-finite values as zero.
 */
export function sumProblemPoints(
  problems: Array<{ maxPoints?: number | null }> | null | undefined,
): number {
  return (problems ?? []).reduce((sum, ap) => {
    const value = typeof ap.maxPoints === 'number' ? ap.maxPoints : 0;
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

/**
 * Flattens a course roster into the single `enrolled` array the frontend expects:
 * each user object annotated with its `courseRole`.
 */
export function toEnrolled<U extends object, R>(
  roster: Array<{ role: R; user: U }>,
): Array<U & { courseRole: R }> {
  return roster.map((r) => ({ ...r.user, courseRole: r.role }));
}

/** The identifying fields a course member can carry in an API/SSR payload. */
type EnrolledMember = {
  id?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatar?: string | null;
  email?: string | null;
  courseRole?: string | null;
};

/**
 * Reduce an `enrolled` list to what a non-staff (student) viewer is allowed to
 * see. Course staff — FACULTY and TAs — keep their name and avatar because the UI
 * labels the course with them, but never their email. Every other member (i.e.
 * fellow students) collapses to a role-only placeholder: this preserves the
 * student *count* the UI derives from the list while exposing no classmate id,
 * name, or email. Use this whenever a course payload is built for a student.
 */
export function toStudentSafeEnrolled(enrolled: EnrolledMember[]): Array<{
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  avatar?: string | null;
  courseRole: string;
}> {
  return enrolled.map((member) => {
    const courseRole = member.courseRole ?? '';
    if (courseRole === 'FACULTY' || courseRole === 'TA') {
      return {
        id: member.id ?? '',
        firstName: member.firstName ?? null,
        lastName: member.lastName ?? null,
        avatar: member.avatar ?? null,
        courseRole,
      };
    }
    // Students (and any non-staff role) become count-only placeholders: an empty,
    // non-identifying id (never rendered — students see no roster list) so the
    // shape stays valid, and no name/email/real id.
    return { id: '', courseRole: courseRole || 'STUDENT' };
  });
}
