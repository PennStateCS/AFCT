import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

import DashboardSidebarShell from '@/components/DashboardSidebarShell';
import Navbar from '@/components/Navbar';
import { SidebarProvider } from '@/components/ui/sidebar';
import AuthGate from '@/components/AuthGate';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const cookieStore = await cookies();
  const sidebarCookie = cookieStore.get('sidebar_state');
  // Default to open for first-time users (no cookie), otherwise use cookie value
  const defaultOpen = sidebarCookie ? sidebarCookie.value === 'true' : true;

  if (!session || !session.user) {
    redirect('/login');
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
        <div className="flex min-h-screen w-full">
          <DashboardSidebarShell />
          <div className="flex flex-1 flex-col p-4">
            <Navbar />
            <main>{children}</main>
          </div>
        </div>
      </AuthGate>
    </SidebarProvider>
  );
}
