import type { Metadata } from 'next';
import SystemLoggingClient from './SystemLoggingClient';

export const metadata: Metadata = {
  title: 'System Logging',
};

export default function SystemStatusPage() {
  return <SystemLoggingClient />;
}
