import type { Metadata } from 'next';
import SystemSettingsClient from './SystemSettingsClient';

export const metadata: Metadata = {
  title: 'System Settings',
};

export default function SystemSettingsPage() {
  return <SystemSettingsClient />;
}
