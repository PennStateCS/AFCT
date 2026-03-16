'use client';

import { useEffect } from 'react';
import { useNavbarBreadcrumbs } from './NavbarBreadcrumbContext';

export default function CourseBreadcrumbSource({
  courseId,
  courseName,
}: {
  courseId: string;
  courseName: string;
}) {
  const { setCourseLabel } = useNavbarBreadcrumbs();

  useEffect(() => {
    setCourseLabel({ id: courseId, name: courseName });
    return () => setCourseLabel(null);
  }, [courseId, courseName, setCourseLabel]);

  return null;
}
