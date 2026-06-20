import type { Metadata } from 'next';
import SystemSubmissionClient from './SystemSubmissionClient';

export const metadata: Metadata = {
  title: 'System Submissions',
};

export default function SystemSubmissionPage() {
  return <SystemSubmissionClient />;
}