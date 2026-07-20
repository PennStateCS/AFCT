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
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === 'collapsed';
  const isActive = pathname === '/dashboard';

  return (
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <TooltipProvider delayDuration={100}>
            {/* Leave the tooltip uncontrolled and hide its content when expanded
                (the label is already visible), rather than toggling `open` between
                false and undefined, which warns about controlled/uncontrolled switch. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  className={
                    'text-sidebar-foreground hover:bg-secondary focus-visible:bg-secondary active:bg-secondary data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground'
                  }
                >
                  {/* aria-current pairs the visual active state with a programmatic one,
                      and the mobile drawer closes on navigation (the layout persists). */}
                  <Link
                    href="/dashboard"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => {
                      if (isMobile) setOpenMobile(false);
                    }}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <LayoutDashboard className="h-4 w-4 shrink-0" />
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      AFCT Dashboard
                    </span>
                  </Link>
                </SidebarMenuButton>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                hidden={!collapsed}
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
