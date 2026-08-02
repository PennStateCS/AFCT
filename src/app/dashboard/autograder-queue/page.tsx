import type { Metadata } from 'next';
import AutograderQueueClient from './AutograderQueueClient';

export const metadata: Metadata = {
  title: 'Submissions',
};

export default function SubmissionsPage() {
  return <AutograderQueueClient />;
}
