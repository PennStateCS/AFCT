'use client';

import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * `className` so the surface this sits on can colour it. It lives on the dashboard header,
 * which is its own chrome band rather than a card, and the button's hover and focus
 * defaults are the page's. The colours are passed in rather than baked here because this
 * is a shared component and the next thing to mount it may well be on a card again.
 */
export function EnhancedSidebarTrigger({ className }: { className?: string }) {
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
      className={cn('shrink-0 cursor-pointer', className)}
    >
      <Icon className="h-12 w-12" />
    </SidebarTrigger>
  );
}
