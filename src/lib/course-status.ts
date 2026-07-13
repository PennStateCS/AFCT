export type CourseDateBucket = 'upcoming' | 'current' | 'past';

/**
 * Bucket a course purely by its date range (publish/archive state ignored),
 * using the same boundaries as {@link getCourseStatusTag}: "upcoming" before it
 * starts, "past" once its end has passed, "current" in between.
 */
export function getCourseDateBucket(
  course: { startDate: string | Date; endDate: string | Date },
  now: Date = new Date(),
): CourseDateBucket {
  const start = new Date(course.startDate);
  const end = new Date(course.endDate);
  if (start > now) return 'upcoming';
  if (end <= now) return 'past';
  return 'current';
}

export function getCourseStatusTag(course: {
  isArchived: boolean;
  isPublished: boolean;
  startDate: string | Date;
  endDate: string | Date;
}) {
  const now = new Date();
  const start = new Date(course.startDate);
  const end = new Date(course.endDate);

  if (course.isArchived) return { status: 'Archived', variant: 'neutral' } as const;
  if (!course.isPublished) return { status: 'Not Published', variant: 'warning' } as const;
  if (start > now) return { status: 'Upcoming', variant: 'info' } as const;
  if (end <= now) return { status: 'Ended', variant: 'danger' } as const;
  return { status: 'Active', variant: 'success' } as const;
}
