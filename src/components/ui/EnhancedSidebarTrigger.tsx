'use client';

import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';

export function EnhancedSidebarTrigger() {
  const { state } = useSidebar();

  const isCollapsed = state === 'collapsed';
  const label = isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar';
  const Icon = isCollapsed ? PanelRightIcon : PanelLeftIcon;

  return (
    <SidebarTrigger aria-label="Toggle Sidebar">
      <Icon className="h-12 w-12" />
    </SidebarTrigger>
  );
}
