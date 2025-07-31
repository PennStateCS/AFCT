import { Sidebar, SidebarSeparator } from '@/components/ui/sidebar';
import DashboardSidebarMenu from '@/components/DashboardSidebarMenu';
import DashboardSidebarHeader from '@/components/DashboardSidebarHeader';

export default function DashboardSidebarShell() {
  return (
    <Sidebar collapsible="icon" className="h-full overflow-x-hidden">
      <DashboardSidebarHeader />
      <SidebarSeparator />
      <DashboardSidebarMenu />
    </Sidebar>
  );
}
