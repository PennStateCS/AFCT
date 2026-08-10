'use client';

import React, { useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { Moon, Sun, UserRound, UserPen, LogOut } from 'lucide-react';
import { Badge } from '@/components/ui/RoleBadge';
import { useNavbarBreadcrumbs } from '@/components/navbar/NavbarBreadcrumbContext';
import type { SessionUser } from '@/types/next-auth';

import { getInitials } from '@/app/utils/initials';
import { safeSignOut } from '@/lib/safe-signout';

/**
 * The two account dialogs load on demand, not with the navbar.
 *
 * The navbar is in the dashboard layout, so it is on every page, and importing these
 * statically put their whole dependency graph, most of it zod and react-hook-form, into the
 * chunk every dashboard route shares: 285 KB paid on every page load for two dialogs most
 * sessions never open.
 *
 * `next/dynamic` only defers until the component RENDERS, so the mount flags below matter as
 * much as the import: rendering these unconditionally with `open={false}`, which is what the
 * navbar used to do, would fetch them on mount and change nothing.
 */

// UI Components
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
import { apiPaths } from '@/lib/api-paths';

const Navbar: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const { data, status } = useSession();
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

  if (status === 'loading') {
    return (
      <header className="bg-brand-teal dark:bg-card mb-4 flex h-16 items-center justify-between rounded-lg p-4 text-white shadow-sm" />
    );
  }

  if (!data?.user) return null;

  const user: SessionUser = data.user;

  return (
    <div>
      <header className="bg-brand-teal dark:bg-card mb-4 flex h-16 items-center justify-between rounded-lg p-3 text-white shadow-sm sm:p-4">
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
                      <BreadcrumbPage className="max-w-[14rem] truncate text-white sm:max-w-[22rem]">
                        {crumb.label}
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        href={crumb.href}
                        className="block max-w-[8rem] truncate text-white hover:underline sm:max-w-[14rem]"
                      >
                        {crumb.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast && (
                    <BreadcrumbSeparator
                      className={`text-white ${mobileVisibility}`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="ml-2 flex items-center gap-2 text-right sm:gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-auto rounded-md px-1 py-1 hover:bg-white/20 sm:px-2 cursor-pointer"
              aria-label={`${user.firstName} ${user.lastName} account menu`}
            >
              <span className="flex items-center gap-2 sm:gap-3">
                <span className="hidden flex-col items-end sm:flex">
                  <span className="max-w-[12rem] truncate font-semibold text-white">
                    {`${user.firstName} ${user.lastName}`}
                  </span>
                  <div className="ml-2 flex items-center gap-2 text-right sm:gap-4">
                    {user.isAdmin && <Badge userRole="ADMIN" className="text-xs" />}
                  </div>
                </span>
                <Avatar className="h-11 w-11">
                  <AvatarImage
                    src={user.avatar ? apiPaths.files.pfp(user.avatar) : undefined}
                    /* Decorative: the trigger button already carries the name. */
                    alt=""
                    cropX={user.cropX ?? 0.5}
                    cropY={user.cropY ?? 0.5}
                    zoom={user.zoom ?? 1}
                  />
                  <AvatarFallback className="text-sm">
                    {getInitials(user.firstName, user.lastName, user.email)}
                  </AvatarFallback>
                </Avatar>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {/* Section header, not an action. A Label keeps it out of the menu's
                focus/arrow-key order; overrides preserve the exact resting look. */}
            <DropdownMenuLabel className="font-normal [&_svg:not([class*='text-'])]:text-muted-foreground">
              <span className="flex w-full items-center gap-2 text-left">
                <UserRound className="h-4 w-4" />
                User Account
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer">
              <Link href="/dashboard/account">
                <UserPen className="h-4 w-4" />
                Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() => void safeSignOut({ callbackUrl: '/' })}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="hover:bg-background dark:hover:bg-accent bg-card dark:bg-background text-foreground border-card-foreground/10 border-2 cursor-pointer"
            >
              <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
              <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
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
  </div>
  );
};

export default Navbar;
