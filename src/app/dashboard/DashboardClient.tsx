'use client';

import Link from 'next/link';

import type { Course, User } from '@prisma/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { getCourseStatusTag } from '@/lib/course-status';
import { formatInstructorNames, getStudentCount, getTAs } from '@/lib/course-utils';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';

type Props = {
  sessionUser: {
    id: string;
    role: string;
  };
  title: string;
  courses: (Course & {
    enrolled?: (User & { courseRole?: string; hasSubmissions?: boolean })[];
  })[];
};

export default function DashboardClient({ sessionUser, courses, title }: Props) {
  const { role } = sessionUser;
  const isPrivileged = role === 'ADMIN' || role === 'FACULTY' || role === 'TA';
  const now = new Date();
  const { timezone } = useEffectiveTimezone();

  const visibleCourses =
    role === 'STUDENT' ? courses.filter((course) => course.isPublished) : courses;

  return (
    <Card className="flex h-full" aria-labelledby="current-courses-title">
      <CardHeader>
        <CardTitle id="current-courses-title" className="text-2xl font-semibold tracking-tight">
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
                  <div
                    className="group border-border bg-card hover:bg-accent flex h-full cursor-pointer overflow-hidden rounded-lg border shadow transition-all hover:shadow-md"
                  >
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
                          const { status, bgColor } = getCourseStatusTag(course);
                          return (
                            <span
                              className={`inline-block rounded ${bgColor} px-2 py-1 text-sm text-white shadow-sm ring-1 ring-gray-900/30`}
                            >
                              {status}
                            </span>
                          );
                        })()}
                      </div>

                      <div className="space-y-1 text-sm">
                        {isPrivileged && (
                          <div>
                            <span className="font-semibold">Enrollment:</span>{' '}
                            {getStudentCount(course.enrolled as any[])}
                          </div>
                        )}
                        <div>
                          <span className="font-semibold">Faculty:</span>{' '}
                          {formatInstructorNames(course.enrolled as any)}
                        </div>
                        <div>
                          <span className="font-semibold">TA(s):</span>{' '}
                          {(() => {
                            const taNames = getTAs(course.enrolled as any)
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
