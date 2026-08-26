import React from 'react';
import type { Metadata, Viewport } from 'next';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'AFCT Dashboard - Login',
  description: 'Sign in to the AFCT Dashboard to manage courses, assignments, and submissions.',
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    title: 'AFCT Dashboard - Login',
    description: 'Sign in to the AFCT Dashboard to manage courses, assignments, and submissions.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AFCT Dashboard - Login',
    description: 'Sign in to the AFCT Dashboard to manage courses, assignments, and submissions.',
  },
};

export const viewport: Viewport = {
  themeColor: '#0F172A',
};

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // Only bounce a genuinely-usable session away from the login page. An
  // idle-expired or disabled account comes back marked inactive (see the auth
  // session callback); treating that as "logged in" and redirecting to /dashboard
  // fights the middleware/dashboard gate that redirects it back here, an infinite
  // loop. Let it fall through and render the login form so the user can re-auth.
  if (session?.user && !session.user.inactive) {
    redirect(session.user.mustChangePassword ? '/change-password' : '/dashboard');
  }

  return (
    // Full bleed. The page below is a split screen whose dark half has to reach the edges of
    // the window, so the shell contributes no gutter and no centring of its own; it used to
    // add `px-4 py-6` and centre the card, which is exactly what a split layout cannot have.
    // `min-h-dvh` rather than `min-h-screen`: on a phone `vh` includes the browser chrome, so
    // the dark panel ran a toolbar's worth past the bottom of what you can see.
    <main role="main" aria-label="Login page" className="min-h-dvh w-full font-sans">
      {/* Unlabelled on purpose, so it is not announced as a third region: the brand panel and
          the sign-in form inside it are the two that carry names. */}
      <section className="w-full">{children}</section>
    </main>
  );
}
