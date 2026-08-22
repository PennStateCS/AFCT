'use client';

import React from 'react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { getCourseStatusTag } from '@/lib/course-status';
import type { EnrolledUser } from '@/lib/course-roster';
import { formatInstructorNames, getStudentCount, getTAs } from '@/lib/course-roster';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date-format';

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
  // visibility and privileged display; a global role can't, since a user may be
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
    // Flat: the course tiles below are the real objects, and a card around them was one
    // boundary too many. It also carried `h-full`, which stretched an almost-empty
    // section down the whole viewport when somebody had no courses.
    <section className="space-y-4" aria-labelledby="current-courses-title">
      <div className="flex items-center justify-between">
        <h2 id="current-courses-title" className="text-2xl font-semibold tracking-tight">
          {title}
        </h2>
      </div>

      {visibleCourses.length === 0 ? (
        <p className="text-muted-foreground italic">No courses found.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          {visibleCourses.map((course) => {
            const isUpcoming = new Date(course.endDate) > now;

            return (
              // No aria-label: it would become the link's whole accessible name and
              // replace the card's contents, so the code, semester, credits, staff, dates
              // and status badge a sighted reader gets would all be dropped. The card's own
              // text names it better than any label could.
              <Link key={course.id} href={`/dashboard/courses/${course.id}`} passHref>
                <div className="group border-border bg-card hover:border-primary hover:bg-primary/5 flex h-full cursor-pointer overflow-hidden rounded-lg border shadow transition-all hover:shadow-md">
                  {/* Vertical colored bar */}
                  <div
                    className={`w-[15px] ${
                      !course.isPublished
                        ? 'bg-status-warning-solid'
                        : isUpcoming
                          ? 'bg-primary'
                          : 'bg-status-neutral-solid'
                    }`}
                  />

                  {/* Content area */}
                  <div className="flex w-full flex-col px-4 py-4 sm:p-5">
                    {/* Top Row: Title and Badge */}
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <div className="truncate text-base font-semibold">
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
    </section>
  );
}
