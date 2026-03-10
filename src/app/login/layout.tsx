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

  if (session) {
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
