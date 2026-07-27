import type { Prisma, EnrollmentStatus } from '@prisma/client';

/**
 * Shared roster-status predicates.
 *
 * A student's `Roster.status` is either ENROLLED (can see and interact with the course)
 * or DROPPED (association and all their work retained, but no access). Two different
 * questions are asked about students across the app, and they must not be conflated:
 *
 *  - ACTIVE_STUDENT_ROSTER: "students who currently belong to the course." Use it for
 *    anything a student's *access* or *new activity* depends on: the access gate, a
 *    student's own course lists / sidebar / dashboard, new assignment-audience targeting,
 *    group eligibility for new groups, and participation statistics.
 *
 *  - ANY_STUDENT_ROSTER: "every student who has ever been on the roster." Use it for
 *    *staff review* surfaces where dropped students still appear (marked "Dropped"): the
 *    roster tab, the submissions views, and the gradebook. Their retained work stays
 *    visible and gradeable.
 *
 * These are course-agnostic fragments: spread them into a where-clause alongside a
 * `courseId` (and `user: { inactive: false }` where an active account is also required).
 * Keeping the rule here means "who counts as an active student" has one definition.
 */

/** The only status in which a student can see and interact with a course. */
export const ENROLLED_STATUS: EnrollmentStatus = 'ENROLLED';

/** Roster fragment: an active student (role STUDENT, ENROLLED). */
export const ACTIVE_STUDENT_ROSTER = {
  role: 'STUDENT',
  status: 'ENROLLED',
} as const satisfies Prisma.RosterWhereInput;

/** Roster fragment: any student regardless of standing (ENROLLED or DROPPED). */
export const ANY_STUDENT_ROSTER = {
  role: 'STUDENT',
} as const satisfies Prisma.RosterWhereInput;

/** True when a status lets the student see and interact with the course. */
export function isEnrolled(status: EnrollmentStatus | null | undefined): boolean {
  return status === 'ENROLLED';
}

/**
 * Roster fragment for an *active member* of a course: on the roster and not a dropped
 * student (FACULTY/TA always count). Spread into `roster: { some: activeMemberOf(userId) }`
 * for the "courses I belong to" lists, so a course a student was dropped from disappears
 * from their own view while their staff courses stay.
 */
export function activeMemberOf(userId: string): Prisma.RosterWhereInput {
  return { userId, NOT: { role: 'STUDENT', status: 'DROPPED' } };
}
