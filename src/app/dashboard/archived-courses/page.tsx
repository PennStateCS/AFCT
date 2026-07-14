import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { getCoursesListForUser } from '@/lib/courses-list';
import ArchivedCoursesClient from './ArchivedCoursesClient';

export const metadata: Metadata = {
  title: 'Archived Courses',
};

export default async function ArchivedCoursesPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="bg-destructive text-destructive-foreground rounded p-4 text-lg">
        You are not signed in.
      </div>
    );
  }

  // Same role-scoped list as the main Courses page: admins see every course,
  // everyone else only the ones they're on the roster of (published, or any they
  // staff); then narrowed to the archived ones for this page.
  const listRole = session.user.isAdmin ? 'ADMIN' : 'STUDENT';
  const all = await getCoursesListForUser(session.user.id, listRole);
  const archived = all.filter((course) => course.isArchived);

  return (
    <ArchivedCoursesClient initialCourses={archived} isAdmin={session.user.isAdmin ?? false} />
  );
}
