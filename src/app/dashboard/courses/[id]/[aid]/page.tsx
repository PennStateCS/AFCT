import type { Metadata } from 'next';
import AssignmentClient from './AssignmentClient';

export const metadata: Metadata = {
  title: 'Assignment',
};

export default function AssignmentPage() {
  return <AssignmentClient />;
}
