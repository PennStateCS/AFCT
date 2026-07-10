'use client';

import React from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { FullCourse } from '@/types/course';
import { getInstructors, type EnrolledUser } from '@/lib/course-utils';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';

interface CourseHeaderProps {
  course: FullCourse;
  isStudent: boolean;
}

/**
 * The inner header content — title, badges, course status, and (for staff) the
 * faculty/TA line and course dates. Extracted so it can sit either in its own
 * card (student view) or above the tab bar in the admin card.
 */
export function CourseHeaderContent({ course, isStudent }: CourseHeaderProps) {
  const { timezone } = useEffectiveTimezone();

  const normalizeDate = (value?: string | Date | null) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  const startDate = normalizeDate(course.startDate);
  const endDate = normalizeDate(course.endDate);
  const formatCourseDate = (value: Date | null) =>
    value ? formatDateTimeInTimeZone(value, timezone) : 'Not set';

  const badgeTheme = {
    upcoming: { variant: 'info' as const },
    open: { variant: 'success' as const },
    closed: { variant: 'neutral' as const },
  } as const;

  const courseStatus = (() => {
    if (!startDate || !endDate) {
      return { label: 'Upcoming', theme: badgeTheme.upcoming };
    }
    const now = Date.now();
    if (now < startDate.getTime()) {
      return { label: 'Upcoming', theme: badgeTheme.upcoming };
    }
    if (now > endDate.getTime()) {
      return { label: 'Closed', theme: badgeTheme.closed };
    }
    return { label: 'Open', theme: badgeTheme.open };
  })();

  const enrolled = course.enrolled ?? [];
  const formatAllNames = (users: EnrolledUser[]) => {
    if (!Array.isArray(users) || users.length === 0) return 'None assigned';
    return users
      .map((u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim())
      .filter(Boolean)
      .join(', ');
  };
  const facultyNames = formatAllNames(getInstructors(enrolled));
  const taNames = formatAllNames(enrolled.filter((u) => u.courseRole === 'TA'));

  // -- render ---------------------------------------------------------------
  return (
    <>
      {/* Title with the badges (and course status) pulled to its right */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <CardTitle
          id="course-page-title"
          role="heading"
          aria-level={1}
          className="text-2xl leading-tight font-semibold tracking-tight"
        >
          <span className="text-muted-foreground">{course.code}</span>
          <span className="text-muted-foreground">: </span>
          {course.name}
        </CardTitle>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{course.semester}</Badge>
          <Badge variant="outline">
            {course.credits} credit{course.credits === 1 ? '' : 's'}
          </Badge>
          <Badge variant={courseStatus.theme.variant}>{courseStatus.label}</Badge>
        </div>
      </div>

      {/* Faculty, TAs, and the course dates all on one row */}
      {!isStudent && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-muted-foreground">Faculty: </span>
            {facultyNames}
          </span>
          <span>
            <span className="text-muted-foreground">TAs: </span>
            {taNames}
          </span>
          <span>
            <span className="text-muted-foreground">Start: </span>
            {formatCourseDate(startDate)}
          </span>
          <span>
            <span className="text-muted-foreground">End: </span>
            {formatCourseDate(endDate)}
          </span>
        </div>
      )}
    </>
  );
}

/** Standalone header card (student view; the admin view embeds the tab bar). */
export function CourseHeader({ course, isStudent }: CourseHeaderProps) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <CourseHeaderContent course={course} isStudent={isStudent} />
      </CardHeader>
    </Card>
  );
}
