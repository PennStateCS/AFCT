'use client';

import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';

export function EnhancedSidebarTrigger() {
  // The desktop `state` and the mobile sheet are separate pieces of state: on mobile
  // toggleSidebar() flips `openMobile` and leaves `state` alone. Reading only `state`
  // meant the icon and aria-expanded described the desktop sidebar while the user was
  // opening and closing the mobile drawer.
  const { state, isMobile, openMobile } = useSidebar();

  const isOpen = isMobile ? openMobile : state === 'expanded';
  const Icon = isOpen ? PanelLeftIcon : PanelRightIcon;

  return (
    <SidebarTrigger
      aria-label={isOpen ? 'Close sidebar' : 'Open sidebar'}
      aria-expanded={isOpen}
      className="cursor-pointer"
    >
      <Icon className="h-12 w-12" />
    </SidebarTrigger>
  );
}
