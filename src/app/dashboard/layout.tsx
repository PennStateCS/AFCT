import { cookies } from 'next/headers';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/authOptions';

import DashboardSidebarShell from '@/components/DashboardSidebarShell';
import Navbar from '@/components/Navbar';
import { SidebarProvider } from '@/components/ui/sidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value === 'true';

  if (!session || !session.user) {
    redirect('/login');
  }

  return (
    <SidebarProvider
      style={{
        '--sidebar-width': '18rem',
        '--sidebar-width-mobile': '10rem',
        '--sidebar-width-icon': '3rem',
      } as React.CSSProperties}
      defaultOpen={defaultOpen}
    >
      <div className="flex min-h-screen w-full">
        <DashboardSidebarShell />
        <div className="flex flex-1 flex-col p-4">
          <Navbar />
          <main>{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
