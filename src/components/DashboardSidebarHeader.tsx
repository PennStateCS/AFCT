'use client';

import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar';
import { usePathname } from 'next/navigation';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { LayoutDashboard } from 'lucide-react';

export default function DashboardSidebarHeader() {
  const pathname = usePathname();

  return (
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={pathname == '/dashboard'}
            className={cn(
              'hover:bg-secondary focus:bg-secondary text-sidebar-foreground',
              'data-[active=true]:bg-secondary',
            )}
          >
            <Link href="/dashboard">
              <LayoutDashboard className="h-4 w-4" />
              AFCT Dashboard
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
}
