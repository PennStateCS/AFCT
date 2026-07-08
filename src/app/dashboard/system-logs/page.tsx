import type { Metadata } from 'next';
import SystemLogsClient from './SystemLogsClient';

export const metadata: Metadata = {
  title: 'System Logs',
};

export default function SystemLogsPage() {
  return <SystemLogsClient />;
}
