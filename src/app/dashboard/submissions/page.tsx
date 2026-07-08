import type { Metadata } from 'next';
import SubmissionsClient from './SubmissionsClient';

export const metadata: Metadata = {
  title: 'Submissions',
};

export default function SubmissionsPage() {
  return <SubmissionsClient />;
}
