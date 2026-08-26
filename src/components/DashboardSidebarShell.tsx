import React from 'react';
import { Sidebar, SidebarSeparator } from '@/components/ui/sidebar';
import DashboardSidebarMenu from '@/components/DashboardSidebarMenu';
import DashboardSidebarHeader from '@/components/DashboardSidebarHeader';

export default function DashboardSidebarShell() {
  return (
    <Sidebar collapsible="icon" className="h-full overflow-x-hidden">
      <DashboardSidebarHeader />
      {/* 6px under the divider, which with the first group's own 8px puts "Administration"
          14px below the rule. At !mb-0 it was 8px, and against a 77px brand block that read as
          the nav being crowded up against the logo rather than starting after it. */}
      <SidebarSeparator className="!mx-0 !mb-1.5" />
      <DashboardSidebarMenu />
    </Sidebar>
  );
}
