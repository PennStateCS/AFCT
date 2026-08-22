'use client';

import React from 'react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { getCourseStatusTag } from '@/lib/course-status';
import type { EnrolledUser } from '@/lib/course-roster';
import { formatInstructorNames, getStudentCount, getTAs } from '@/lib/course-roster';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateInTimeZone } from '@/lib/date-format';

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
      <div className="flex items-center justify-between gap-4">
        <h2 id="current-courses-title" className="text-2xl font-semibold tracking-tight">
          {title}
        </h2>
        {/* A quiet way out to the full list, not an action. Everyone who reaches the
            dashboard can open /dashboard/courses; the page scopes itself per viewer. */}
        <Link
          href="/dashboard/courses"
          className="text-muted-foreground hover:text-foreground shrink-0 text-sm hover:underline"
        >
          View all courses <span aria-hidden="true">&rarr;</span>
        </Link>
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
                    className={`w-1.5 shrink-0 ${
                      !course.isPublished
                        ? 'bg-status-warning-solid'
                        : isUpcoming
                          ? 'bg-primary'
                          : 'bg-status-neutral-solid'
                    }`}
                  />

                  {/* Content area */}
                  <div className="flex w-full min-w-0 flex-col px-4 py-3.5">
                    {/* Top Row: Title and Badge */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{course.name}</div>
                        <div className="text-muted-foreground truncate text-sm">
                          {course.code} &middot; {course.semester} &middot; {course.credits} credits
                        </div>
                      </div>

                      {(() => {
                        const { status, variant } = getCourseStatusTag(course);
                        return <Badge variant={variant}>{status}</Badge>;
                      })()}
                    </div>

                    {/* The same facts as before, with the role carried by a trailing label
                        rather than a bold prefix on every line: four bold words down the
                        left edge outweighed the course name above them. */}
                    <div className="text-muted-foreground mt-3 space-y-0.5 text-sm">
                      {/* Staff only. A student must not learn the size of the roster. */}
                      {canManageCourse(course) && (
                        <div>
                          {getStudentCount(course.enrolled)}{' '}
                          {getStudentCount(course.enrolled) === 1 ? 'student' : 'students'}
                        </div>
                      )}
                      <div className="truncate">
                        {formatInstructorNames(course.enrolled)}{' '}
                        <span aria-hidden="true">&middot;</span> Faculty
                      </div>
                      {(() => {
                        const tas = getTAs(course.enrolled);
                        const taNames = tas
                          .map((ta) => `${ta.firstName ?? ''} ${ta.lastName ?? ''}`.trim())
                          .filter(Boolean)
                          .join(', ');
                        // "No TAs assigned" rather than dropping the line: the absence of a
                        // TA is information, and the old card said "TA(s): None".
                        return (
                          <div className="truncate">
                            {taNames ? (
                              <>
                                {taNames} <span aria-hidden="true">&middot;</span>{' '}
                                {tas.length === 1 ? 'TA' : 'TAs'}
                              </>
                            ) : (
                              'No TAs assigned'
                            )}
                          </div>
                        );
                      })()}
                      <div>
                        {formatDateInTimeZone(course.startDate, timezone)} &ndash;{' '}
                        {formatDateInTimeZone(course.endDate, timezone)}
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
