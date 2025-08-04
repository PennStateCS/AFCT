'use client';

import { format } from 'date-fns';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { Course, User } from '@prisma/client';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';

type Props = {
  sessionUser: {
    id: string;
    role: string;
  };
  courses: (Course & {
    students?: User[];
    faculty?: User[];
    tas?: User[];
  })[];
};

export default function DashboardClient({ sessionUser, courses }: Props) {
  const { role } = sessionUser;
  const isPrivileged = role === 'ADMIN' || role === 'FACULTY' || role === 'TA';
  const now = new Date();

  const visibleCourses =
    role === 'STUDENT' ? courses.filter((course) => course.isPublished) : courses;

  return (
    <Card className="flex h-full">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">Course List</CardTitle>
      </CardHeader>

      <CardContent>
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
                  role="link"
                  className="group border-border bg-card flex h-full cursor-pointer overflow-hidden rounded-lg border shadow transition-all hover:bg-gray-50 hover:shadow-md"
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
                      {course.isPublished ? (
                        <span className="inline-block rounded bg-green-700 px-2 py-1 text-sm text-white shadow-sm ring-1 ring-green-900/30">
                          Published
                        </span>
                      ) : (
                        <span className="inline-block rounded bg-yellow-700 px-2 py-1 text-sm text-white shadow-sm ring-1 ring-yellow-900/30">
                          Not Published
                        </span>
                      )}
                    </div>

                    <div className="space-y-1 text-sm">
                      {isPrivileged && (
                        <div>
                          <span className="font-semibold">Enrollment:</span>{' '}
                          {(course.students ?? []).length}
                        </div>
                      )}
                      <div>
                        <span className="font-semibold">Instructor:</span>{' '}
                        {(course.faculty ?? [])
                          .map((f) => `${f.firstName ?? ''} ${f.lastName ?? ''}`)
                          .join(', ') || 'TBA'}
                      </div>
                      <div>
                        <span className="font-semibold">Dates:</span>{' '}
                        {format(new Date(course.startDate), 'M-d-yyyy p')} to{' '}
                        {format(new Date(course.endDate), 'M-d-yyyy p')}
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
