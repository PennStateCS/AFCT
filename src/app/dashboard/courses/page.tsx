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
  const role = session?.user?.role;

  const initialCourses = userId && role ? await getCoursesListForUser(userId, role) : [];

  return <CoursesClient initialCourses={initialCourses} />;
}
