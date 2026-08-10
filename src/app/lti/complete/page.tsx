import type { Metadata } from 'next';
import { Suspense } from 'react';
import CompleteLaunchClient from './CompleteLaunchClient';

export const metadata: Metadata = {
  title: 'Opening AFCT',
};

/**
 * The last step of a launch: spend the ticket, get a session, go to the dashboard.
 *
 * A page rather than a redirect because NextAuth mints the session from the browser, and this
 * is the smallest thing that can ask it to.
 */
export default function CompleteLaunchPage() {
  return (
    <Suspense fallback={null}>
      <CompleteLaunchClient />
    </Suspense>
  );
}
