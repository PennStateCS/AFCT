'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import StudentAssignmentView from '@/components/assignments/StudentAssignmentView';
import PrivilegeAssignmentView from '@/components/assignments/PrivilegeAssignmentView';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { AssignmentWithDetails } from '@/lib/assignment-details';

type AssignmentClientProps = {
  initialAssignment?: AssignmentWithDetails | null;
  initialAssignments?: { id: string; title: string }[];
  // Whether the viewer is course staff (admin, or FACULTY/TA in this course),
  // computed server-side from the roster. Drives the privileged vs student view.
  isStaff?: boolean;
};

export default function AssignmentClient({
  initialAssignment = null,
  initialAssignments,
  isStaff = false,
}: AssignmentClientProps) {
  const { status } = useSession();

  if (status === 'loading') {
    return <LoadingSpinner label="Loading" />;
  }

  if (status === 'unauthenticated') {
    return <div className="p-6">You must be signed in to view this page.</div>;
  }

  if (!isStaff) {
    return <StudentAssignmentView initialAssignment={initialAssignment} />;
  }

  return (
    <PrivilegeAssignmentView
      initialAssignment={initialAssignment}
      initialAssignments={initialAssignments}
    />
  );
}
