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
      // A callout, not a saturated block. `bg-destructive` with white text is 2.89:1 in
      // dark, because --destructive lightens there to work as TEXT; the status-danger
      // triad is the pairing built for a filled message and is theme-aware.
      <div
        role="alert"
        className="border-status-danger-border bg-status-danger-bg text-status-danger rounded border p-4 text-lg"
      >
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
