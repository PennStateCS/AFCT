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
