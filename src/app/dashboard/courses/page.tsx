import type { Metadata } from 'next';
import CoursesClient from './CoursesClient';

export const metadata: Metadata = {
  title: 'Courses',
};

export default function CoursesPage() {
  return <CoursesClient />;
}
