import type { Metadata } from 'next';
import DevelopmentTestsClient from './DevelopmentTestsClient';

export const metadata: Metadata = {
  title: 'Development Tests',
};

export default function DevelopmentTestsPage() {
  return <DevelopmentTestsClient />;
}
