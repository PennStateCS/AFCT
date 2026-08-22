import type { Metadata } from 'next';
import SubmissionsClient from './SubmissionsClient';
import { WorkspaceSurface } from '@/components/WorkspaceSurface';

export const metadata: Metadata = {
  title: 'Submissions',
};

export default function SubmissionsPage() {
  // A work page, so it sits on the white surface rather than the slate canvas.
  return (
    <WorkspaceSurface>
      <SubmissionsClient />
    </WorkspaceSurface>
  );
}
