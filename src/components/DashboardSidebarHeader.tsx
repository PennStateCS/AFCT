'use client';

import React from 'react';
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar';
import { usePathname } from 'next/navigation';

import Link from 'next/link';
import { LayoutDashboard } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function DashboardSidebarHeader() {
  const pathname = usePathname();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  return (
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <TooltipProvider delayDuration={100}>
            <Tooltip open={collapsed ? undefined : false}>
              <TooltipTrigger asChild>
                <SidebarMenuButton
                  asChild
                  isActive={pathname == '/dashboard'}
                  className={
                    'text-sidebar-foreground hover:bg-secondary focus-visible:bg-secondary active:bg-secondary data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground'
                  }
                >
                  <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
                    <LayoutDashboard className="h-4 w-4 shrink-0" />
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      AFCT Dashboard
                    </span>
                  </Link>
                </SidebarMenuButton>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="bg-sidebar text-sidebar-foreground px-5 text-sm shadow"
                sideOffset={10}
              >
                AFCT Dashboard
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
}
