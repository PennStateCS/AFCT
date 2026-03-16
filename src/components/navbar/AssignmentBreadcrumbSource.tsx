'use client';

import { useEffect } from 'react';
import { useNavbarBreadcrumbs } from './NavbarBreadcrumbContext';

export default function AssignmentBreadcrumbSource({
  assignmentId,
  assignmentTitle,
}: {
  assignmentId: string;
  assignmentTitle: string;
}) {
  const { setAssignmentLabel } = useNavbarBreadcrumbs();

  useEffect(() => {
    setAssignmentLabel({ id: assignmentId, title: assignmentTitle });
    return () => setAssignmentLabel(null);
  }, [assignmentId, assignmentTitle, setAssignmentLabel]);

  return null;
}
