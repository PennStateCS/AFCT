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
  // fights the middleware/dashboard gate that redirects it back here — an infinite
  // loop. Let it fall through and render the login form so the user can re-auth.
  if (session?.user && !session.user.inactive) {
    redirect(session.user.mustChangePassword ? '/change-password' : '/dashboard');
  }

  return (
    <main
      role="main"
      aria-label="Login page"
      className="bg-background text-foreground flex min-h-screen w-full items-center justify-center font-sans"
    >
      <section aria-label="Authentication panel" className="w-full px-4 py-6">
        {children}
      </section>
    </main>
  );
}
