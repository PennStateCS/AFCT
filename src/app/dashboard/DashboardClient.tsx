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
    <Card className="space-y-4">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold tracking-tight">Course List</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-1 2xl:grid-cols-2">
          {visibleCourses.map((course) => {
            const isUpcoming = new Date(course.endDate) > now;

            return (
              <Link key={course.id} href={`/dashboard/courses/${course.id}`} passHref>
                <Card className="h-full cursor-pointer bg-gradient-to-b from-gray-50 via-white to-slate-200 shadow">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-x-2 text-lg font-semibold tracking-tight">
                      📘 {course.name}
                    </CardTitle>
                    <CardDescription className="ml-8 text-base">
                      {course.code} • {course.semester} • {course.credits} credits
                    </CardDescription>
                    <div className="mt-1 ml-8">
                      {course.isPublished ? (
                        <Badge className="bg-green-200 text-sm font-semibold text-black shadow">
                          Published
                        </Badge>
                      ) : (
                        <Badge className="bg-yellow-200 text-sm font-semibold text-black shadow">
                          Not Published
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="mt-2 ml-8 space-y-1">
                    {isPrivileged && (
                      <div>
                        <span className="font-semibold">Enrollment:</span>{' '}
                        {(course.students ?? []).length}
                      </div>
                    )}
                    <div>
                      <span className="font-semibold">Dates:</span>{' '}
                      {format(new Date(course.startDate), 'MMM d, yyyy')} to{' '}
                      {format(new Date(course.endDate), 'MMM d, yyyy')}
                    </div>
                    <div>
                      <span className="font-semibold">Instructor(s):</span>{' '}
                      {(course.faculty ?? [])
                        .map((f) => `${f.firstName ?? ''} ${f.lastName ?? ''}`)
                        .join(', ') || 'TBA'}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
