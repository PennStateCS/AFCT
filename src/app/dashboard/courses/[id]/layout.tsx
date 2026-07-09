import React from 'react';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { canAccessCourse } from '@/lib/permissions';
import CourseBreadcrumbSource from '@/components/navbar/CourseBreadcrumbSource';

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export default async function CourseLayout({ children, params }: Props) {
  const { id } = await params;
  // Only expose the course name (via the breadcrumb) to someone who may access
  // the course — a system admin or an enrolled member. This mirrors the gate on
  // the page itself so a non-member can't learn a course's name from the URL,
  // and it doesn't rely on Next discarding this layout when the page 404s.
  const session = await auth();
  const course = (await canAccessCourse(session?.user, id))
    ? await prisma.course.findUnique({
        where: { id },
        select: { id: true, name: true },
      })
    : null;

  return (
    <>
      {course ? <CourseBreadcrumbSource courseId={course.id} courseName={course.name} /> : null}
      {children}
    </>
  );
}
