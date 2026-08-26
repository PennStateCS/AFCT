import type { badgeVariants } from '@/components/ui/badge';
import type { VariantProps } from 'class-variance-authority';

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

/**
 * Which badge treatment a settled concept gets.
 *
 * Mapping only. Nothing here decides whether a submission is late or a course is open: that
 * is domain logic and stays where the domain lives. This file exists because the same
 * concept was being mapped to a colour in several components at once, and two of them had
 * already drifted.
 */

/**
 * A course's own lifecycle, from its start and end dates.
 *
 * Deliberately separate from registration below even though the two resolve to the same
 * treatment today and share all three words. They answer different questions ("is the course
 * running" against "can somebody still enrol"), and one of them will change first.
 */
export const COURSE_LIFECYCLE_BADGE = {
  upcoming: 'info',
  open: 'success',
  closed: 'neutral',
} as const satisfies Record<string, BadgeVariant>;

/** Whether the registration window is open, from its own pair of dates. */
export const REGISTRATION_STATUS_BADGE = {
  upcoming: 'info',
  open: 'success',
  closed: 'neutral',
} as const satisfies Record<string, BadgeVariant>;

/**
 * Roles, in categorical hues.
 *
 * Not semantic ones, which is the point of the change: Admin used to be red and Student
 * green, so the roster read as a list of failures and successes. A role is an identity, and
 * an identity is neither.
 */
export const ROLE_BADGE = {
  ADMIN: 'category-violet',
  FACULTY: 'category-blue',
  TA: 'category-amber',
  STUDENT: 'category-slate',
} as const satisfies Record<string, BadgeVariant>;

/** How a role is written when the badge has no explicit label. TA stays an initialism. */
export const ROLE_LABEL = {
  ADMIN: 'Admin',
  FACULTY: 'Faculty',
  TA: 'TA',
  STUDENT: 'Student',
} as const satisfies Record<keyof typeof ROLE_BADGE, string>;

/**
 * Activity-log categories, in categorical hues. Green is Problem and rose is Grade: neither
 * reports a state, and both would be a mistake to read as one.
 */
export const ACTIVITY_CATEGORY_BADGE = {
  SYSTEM: 'category-slate',
  USER: 'category-blue',
  COURSE: 'category-indigo',
  ASSIGNMENT: 'category-violet',
  PROBLEM: 'category-green',
  SUBMISSION: 'category-orange',
  GRADE: 'category-rose',
} as const satisfies Record<string, BadgeVariant>;

/** A category the log has invented since this map was written still has to render. */
export const ACTIVITY_CATEGORY_FALLBACK: BadgeVariant = 'category-slate';

/**
 * Enrolment standing, which is a status and stays semantic. Kept apart from the role badge on
 * purpose: a dropped Faculty member is still Faculty, and encoding one through the other's
 * colour would lose that.
 */
export const ENROLLMENT_STATUS_BADGE = {
  ENROLLED: 'success',
  DROPPED: 'warning',
} as const satisfies Record<string, BadgeVariant>;
