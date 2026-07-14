import React from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

import DashboardSidebarShell from '@/components/DashboardSidebarShell';
import Navbar from '@/components/Navbar';
import { SidebarProvider } from '@/components/ui/sidebar';
import AuthGate from '@/components/AuthGate';
import { NavbarBreadcrumbProvider } from '@/components/navbar/NavbarBreadcrumbContext';
import QueryProvider from '@/components/providers/QueryProvider';
import SessionWatcher from '@/components/session/SessionWatcher';

export const metadata: Metadata = {
  title: {
    default: 'AFCT Dashboard',
    template: 'AFCT Dashboard - %s',
  },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get('sidebar_state');
  // Default to open for first-time users (no cookie), otherwise use cookie value
  const defaultOpen = sidebarCookie ? sidebarCookie.value === 'true' : true;

  // Reject a missing session, or one the session callback marked inactive (a
  // disabled/deleted account or one whose idle-timeout has lapsed) so a stale
  // token can't SSR-render a dashboard page.
  if (!session || !session.user || session.user.inactive) {
    redirect('/login');
  }

  if (session.user.mustChangePassword) {
    redirect('/change-password');
  }

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': '18rem',
          '--sidebar-width-mobile': '10rem',
          '--sidebar-width-icon': '3rem',
        } as React.CSSProperties
      }
      defaultOpen={defaultOpen}
    >
      <AuthGate>
        <QueryProvider>
          <SessionWatcher />
          <NavbarBreadcrumbProvider>
            <div className="flex min-h-screen w-full">
              {/* Skip link: visually hidden until a keyboard user tabs to it, then it
                  jumps focus past the sidebar and navbar to the page content. */}
              <a
                href="#main-content"
                className="bg-background text-foreground ring-ring sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:shadow-md focus:ring-2"
              >
                Skip to main content
              </a>
              <DashboardSidebarShell />
              <div className="flex flex-1 flex-col p-4">
                <Navbar />
                <main id="main-content" tabIndex={-1} lang="en">
                  {children}
                </main>
              </div>
            </div>
          </NavbarBreadcrumbProvider>
        </QueryProvider>
      </AuthGate>
    </SidebarProvider>
  );
}
