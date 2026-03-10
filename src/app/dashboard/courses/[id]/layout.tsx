import React from 'react';
import { prisma } from '@/lib/prisma';
import CourseBreadcrumbSource from '@/components/navbar/CourseBreadcrumbSource';

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export default async function CourseLayout({ children, params }: Props) {
  const { id } = await params;
  const course = await prisma.course.findUnique({
    where: { id },
    select: { id: true, name: true },
  });

  return (
    <>
      {course ? <CourseBreadcrumbSource courseId={course.id} courseName={course.name} /> : null}
      {children}
    </>
  );
}
