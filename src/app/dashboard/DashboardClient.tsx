'use client';

import React from 'react';
import Link from 'next/link';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getCourseStatusTag } from '@/lib/course-status';
import type { EnrolledUser } from '@/lib/course-utils';
import { formatInstructorNames, getStudentCount, getTAs } from '@/lib/course-utils';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';

type DashboardCourse = {
  id: string;
  name: string;
  code: string;
  semester: string;
  credits: number;
  startDate: string | Date;
  endDate: string | Date;
  isPublished: boolean;
  isArchived: boolean;
  enrolled?: EnrolledUser[];
  // The viewer's role in THIS course (from their roster entry). Drives per-course
  // visibility and privileged display — a global role can't, since a user may be
  // faculty in one course and a student in another.
  userRole?: 'FACULTY' | 'TA' | 'STUDENT';
};

type Props = {
  sessionUser: {
    id: string;
    isAdmin: boolean;
  };
  title: string;
  courses: DashboardCourse[];
};

export default function DashboardClient({ sessionUser, courses, title }: Props) {
  const { isAdmin } = sessionUser;
  const now = new Date();
  const { timezone } = useEffectiveTimezone();

  // Course staff (FACULTY/TA in that course) or a system admin may see the course
  // even while it's unpublished and see its enrollment count; students see neither.
  const canManageCourse = (course: DashboardCourse) =>
    isAdmin || course.userRole === 'FACULTY' || course.userRole === 'TA';

  const visibleCourses = courses.filter((course) => course.isPublished || canManageCourse(course));

  return (
    <Card className="flex h-full" aria-labelledby="current-courses-title">
      <CardHeader>
        <CardTitle
          id="current-courses-title"
          role="heading"
          aria-level={2}
          className="text-2xl font-semibold tracking-tight"
        >
          {title}
        </CardTitle>
      </CardHeader>

      <CardContent>
        {visibleCourses.length === 0 ? (
          <p className="text-muted-foreground italic">No courses found.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-1 2xl:grid-cols-2">
            {visibleCourses.map((course) => {
              const isUpcoming = new Date(course.endDate) > now;

              return (
                <Link
                  key={course.id}
                  href={`/dashboard/courses/${course.id}`}
                  passHref
                  aria-label={`View course ${course.name}`}
                >
                  <div className="group border-border bg-card hover:bg-accent flex h-full cursor-pointer overflow-hidden rounded-lg border shadow transition-all hover:shadow-md">
                    {/* Vertical colored bar */}
                    <div
                      className={`w-[15px] ${
                        !course.isPublished
                          ? 'bg-yellow-500'
                          : isUpcoming
                            ? 'bg-primary'
                            : 'bg-gray-400'
                      }`}
                    />

                    {/* Content area */}
                    <div className="flex w-full flex-col px-4 py-4 sm:p-5">
                      {/* Top Row: Title and Badge */}
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                        <div className="text-md truncate font-semibold">
                          {course.name}
                          <div className="text-muted-foreground mb-2 text-sm">
                            {course.code} • {course.semester} • {course.credits} credits
                          </div>
                        </div>

                        {(() => {
                          const { status, variant } = getCourseStatusTag(course);
                          return <Badge variant={variant}>{status}</Badge>;
                        })()}
                      </div>

                      <div className="space-y-1 text-sm">
                        {canManageCourse(course) && (
                          <div>
                            <span className="font-semibold">Enrollment:</span>{' '}
                            {getStudentCount(course.enrolled)}
                          </div>
                        )}
                        <div>
                          <span className="font-semibold">Faculty:</span>{' '}
                          {formatInstructorNames(course.enrolled)}
                        </div>
                        <div>
                          <span className="font-semibold">TA(s):</span>{' '}
                          {(() => {
                            const taNames = getTAs(course.enrolled)
                              .map((ta) => `${ta.firstName ?? ''} ${ta.lastName ?? ''}`.trim())
                              .filter(Boolean)
                              .join(', ');
                            return taNames || 'None';
                          })()}
                        </div>
                        <div>
                          <span className="font-semibold">Dates:</span>{' '}
                          {formatDateTimeInTimeZone(course.startDate, timezone)} to{' '}
                          {formatDateTimeInTimeZone(course.endDate, timezone)}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
