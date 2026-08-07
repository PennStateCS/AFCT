import type { Metadata } from 'next';
import AutograderClient from './AutograderClient';

export const metadata: Metadata = {
  title: 'Autograder',
};

export default function AutograderPage() {
  return <AutograderClient />;
}
