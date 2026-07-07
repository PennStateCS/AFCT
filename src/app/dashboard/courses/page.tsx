import type { Metadata } from 'next';
import CoursesClient from './CoursesClient';
import { auth } from '@/lib/auth';
import { getCoursesListForUser } from '@/lib/courses-list';

export const metadata: Metadata = {
  title: 'Courses',
};

export default async function CoursesPage() {
  const session = await auth();
  const userId = session?.user?.id;
  // Global admins see all courses; everyone else is scoped to their published
  // enrollments. Per-course FACULTY/TA privilege now lives in Roster.role and is
  // resolved inside getCoursesListForUser via the roster filter.
  const listRole = session?.user?.isAdmin ? 'ADMIN' : 'STUDENT';

  const initialCourses = userId ? await getCoursesListForUser(userId, listRole) : [];

  return <CoursesClient initialCourses={initialCourses} />;
}
