import type { Metadata } from 'next';
import CourseClient from './CourseClient';

export const metadata: Metadata = {
  title: 'Course',
};

export default function AdminCoursePage() {
  return <CourseClient />;
}
