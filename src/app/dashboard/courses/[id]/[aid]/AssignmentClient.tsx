'use client';

import { useSession } from 'next-auth/react';
import StudentAssignmentView from '@/components/assignments/StudentAssignmentView';
import PrivilegeAssignmentView from '@/components/assignments/PrivilegeAssignmentView';
import LoadingSpinner from '@/components/ui/loading-spinner';

export default function AssignmentClient() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return <LoadingSpinner label="Loading" />;
  }

  if (status === 'unauthenticated' || !session) {
    return <div className="p-6">You must be signed in to view this page.</div>;
  }

  const role = session.user?.role;

  if (role === 'STUDENT') {
    return <StudentAssignmentView />;
  }

  return <PrivilegeAssignmentView />;
}
