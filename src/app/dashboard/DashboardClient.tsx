'use client';

import React from 'react';
import Link from 'next/link';
import { Book } from 'lucide-react';

import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { getCourseStatusTag } from '@/lib/course-status';
import type { EnrolledUser } from '@/lib/course-roster';
import { getStudentCount } from '@/lib/course-roster';

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

/**
 * The number a course is known by, for the row's tile: "CMPEN 271" reads as "271" on a
 * wall timetable and in conversation. Takes the last run of digits rather than assuming
 * a prefix, so a code shaped differently still yields something, and falls back to the
 * whole code when there are no digits at all. The full code stays in the row text.
 */
function courseNumber(code: string): string {
  return code.match(/\d+/g)?.pop() ?? code;
}

/** Decorative only, alternating so stacked rows are easy to tell apart. The dark cobalt
 *  pair is spelled out: cobalt at 10% behind a cobalt glyph is under 3:1 on a dark card. */
const NUMBER_TILES = [
  'bg-primary/10 text-primary dark:bg-blue-950/40 dark:text-blue-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
] as const;

export default function DashboardClient({ sessionUser, courses, title }: Props) {
  const { isAdmin } = sessionUser;

  // Course staff (FACULTY/TA in that course) or a system admin may see the course
  // even while it's unpublished and see its enrollment count; students see neither.
  const canManageCourse = (course: DashboardCourse) =>
    isAdmin || course.userRole === 'FACULTY' || course.userRole === 'TA';

  const visibleCourses = courses.filter((course) => course.isPublished || canManageCourse(course));

  return (
    // One module rather than a card per course. The tiles duplicated the Courses page at
    // three times the height, so a viewer with four courses saw one screenful of dashboard
    // and nothing else. Rows carry what you need to pick one; the Courses page carries the
    // rest (credits, faculty, TAs, dates), which is where managing a course happens.
    <section
      className="border-border bg-card overflow-hidden rounded-lg border"
      aria-labelledby="courses-title"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <h2 id="courses-title" className="flex items-center gap-2.5 text-base font-semibold">
          {/* Decorative: the heading beside it already says what this is. Matches the
              treatment on the two rail cards, in a third accent so the three headings
              are distinguishable at a glance. */}
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Book className="size-4" aria-hidden="true" />
          </span>
          <span>{title}</span>
        </h2>
        {/* A quiet way out to the full list, not an action. Everyone who reaches the
            dashboard can open /dashboard/courses; the page scopes itself per viewer. */}
        <Link
          href="/dashboard/courses"
          className="text-muted-foreground hover:text-foreground shrink-0 text-sm hover:underline"
        >
          View all <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>

      {visibleCourses.length === 0 ? (
        <p className="text-muted-foreground border-border border-t px-4 py-6 text-sm">
          No current courses.
        </p>
      ) : (
        <ul>
          {visibleCourses.map((course, index) => {
            const { status, variant } = getCourseStatusTag(course);
            // Staff only. A student must not learn the size of the roster.
            const students = canManageCourse(course) ? getStudentCount(course.enrolled) : null;

            return (
              <li key={course.id} className="border-border border-t">
                {/* No aria-label: it would become the link's whole accessible name and
                    replace the row's contents, so the code, semester, enrollment and
                    status a sighted reader gets would all be dropped. The row's own text
                    names it better than any label could. */}
                <Link
                  href={`/dashboard/courses/${course.id}`}
                  className="hover:bg-accent/50 focus-visible:ring-ring flex items-start gap-3 px-4 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:-outline-offset-2"
                >
                  {/* aria-hidden: the full code is already in the row text right beside
                      it, so announcing "271" first would only stutter. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-11 shrink-0 items-center justify-center rounded-lg text-base font-semibold',
                      NUMBER_TILES[index % NUMBER_TILES.length],
                    )}
                  >
                    {courseNumber(course.code)}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-muted-foreground shrink-0 text-sm font-medium">
                        {course.code}
                      </span>
                      <span className="min-w-0 truncate font-medium">{course.name}</span>
                    </span>
                    <span className="text-muted-foreground mt-0.5 block truncate text-sm">
                      {course.semester}
                      {students !== null && (
                        <>
                          <span aria-hidden="true"> &middot; </span>
                          {/* Its own element so the roster size is one addressable node,
                              which is what the staff-only visibility test asserts on. */}
                          <span>{`${students} ${students === 1 ? 'student' : 'students'}`}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <Badge variant={variant} className="shrink-0">
                    {status}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
