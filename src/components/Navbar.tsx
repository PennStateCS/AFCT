'use client';

import React, { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { useNavbarBreadcrumbs } from '@/components/navbar/NavbarBreadcrumbContext';

/**
 * Breadcrumbs, the sidebar trigger and the theme picker. Nothing here reads the session:
 * the account menu lives in the sidebar footer, which is the one place on desktop that
 * carries the name, the avatar and Sign out.
 */

// UI Components
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';

// Local
import { EnhancedSidebarTrigger } from './ui/EnhancedSidebarTrigger';

const Navbar: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const { courseLabel, assignmentLabel } = useNavbarBreadcrumbs();

  const crumbs = useMemo(() => {
    const toTitleCase = (value: string) =>
      value
        .split('-')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const segments = pathname.split('/').filter(Boolean);
    const dashboardIndex = segments.indexOf('dashboard');
    const dashboardSegments = dashboardIndex >= 0 ? segments.slice(dashboardIndex + 1) : segments;

    const nextCrumbs: Array<{ href: string; label: string; isPage?: boolean }> = [
      { href: '/dashboard', label: 'Dashboard', isPage: dashboardSegments.length === 0 },
    ];

    if (dashboardSegments[0] === 'courses') {
      nextCrumbs.push({
        href: '/dashboard/courses',
        label: 'Courses',
        isPage: dashboardSegments.length === 1,
      });

      const courseId = dashboardSegments[1];
      if (courseId) {
        nextCrumbs.push({
          href: `/dashboard/courses/${courseId}`,
          label: courseLabel?.id === courseId ? courseLabel.name : toTitleCase(courseId),
          isPage: dashboardSegments.length === 2,
        });
      }

      const assignmentId = dashboardSegments[2];
      if (assignmentId) {
        nextCrumbs.push({
          href: `/dashboard/courses/${courseId}/${assignmentId}`,
          label:
            assignmentLabel?.id === assignmentId
              ? assignmentLabel.title
              : toTitleCase(assignmentId),
          isPage: dashboardSegments.length === 3,
        });
      }
    } else if (dashboardSegments[0] !== undefined) {
      let hrefAcc = '/dashboard';
      dashboardSegments.forEach((segment, index) => {
        hrefAcc = `${hrefAcc}/${segment}`;
        nextCrumbs.push({
          href: hrefAcc,
          label: toTitleCase(segment),
          isPage: index === dashboardSegments.length - 1,
        });
      });
    }

    return nextCrumbs;
  }, [pathname, courseLabel, assignmentLabel]);

  return (
    // Chrome, not a banner: the teal block competed with the page heading under it. Flat
    // on the page background with a single divider, so hierarchy comes from the content.
    <header className="border-border mb-5 flex h-14 items-center justify-between border-b px-1">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
        <EnhancedSidebarTrigger />
        <Breadcrumb aria-label="Breadcrumb">
          <BreadcrumbList className="max-w-[50vw] flex-nowrap overflow-hidden text-sm sm:max-w-[60vw]">
            {crumbs.map((crumb, index) => {
              const isLast = !!crumb.isPage;
              const isMobileHidden = index > 0 && !isLast;
              const mobileVisibility = isMobileHidden ? 'hidden sm:inline-flex' : 'inline-flex';

              return (
                <React.Fragment key={crumb.href}>
                  <BreadcrumbItem className={`${mobileVisibility} min-w-0`}>
                    {isLast ? (
                      <BreadcrumbPage className="max-w-[14rem] truncate font-medium sm:max-w-[22rem]">
                        {crumb.label}
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        href={crumb.href}
                        className="block max-w-[8rem] truncate hover:underline sm:max-w-[14rem]"
                      >
                        {crumb.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator className={mobileVisibility} />}
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="ml-2 flex items-center gap-2 text-right sm:gap-4">
        <DropdownMenu>
          {/* `relative` so the Moon anchors to the button. It was absolutely positioned at
              its static spot, which the old wide button happened to have room for; in a
              square icon button it would hang off the right edge. */}
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-foreground relative">
              <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
              <Moon className="absolute top-1/2 left-1/2 h-[1.2rem] w-[1.2rem] -translate-x-1/2 -translate-y-1/2 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
              <span className="sr-only">Toggle theme</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* Radio group so the current theme is exposed as the checked option. */}
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

export default Navbar;
