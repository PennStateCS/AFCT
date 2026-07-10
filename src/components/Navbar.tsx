'use client';

import React, { useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Moon, Sun, UserRound, UserPen, LockKeyhole, LogOut } from 'lucide-react';
import { Badge } from '@/components/ui/RoleBadge';
import { useNavbarBreadcrumbs } from '@/components/navbar/NavbarBreadcrumbContext';
import type { SessionUser } from '@/types/next-auth';

import { getInitials } from '@/app/utils/initials';
import { safeSignOut } from '@/lib/safe-signout';

import { ChangePasswordDialog } from '@/components/dialogs/ChangePasswordDialog';
import { EditProfileDialog } from '@/components/dialogs/EditProfileDialog';

// UI Components
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

const Navbar: React.FC = () => {
  const { setTheme } = useTheme();
  const { data, status } = useSession();
  const pathname = usePathname();
  const { courseLabel, assignmentLabel } = useNavbarBreadcrumbs();
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

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
      <nav className="bg-secondary mb-4 flex h-16 items-center justify-between rounded-lg p-4 text-white shadow-sm" />
    );
  }

  if (!data?.user) return null;

  const user: SessionUser = data.user;

  return (
    <div>
      <nav className="bg-secondary mb-4 flex h-16 items-center justify-between rounded-lg p-3 text-white shadow-sm sm:p-4">
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
                        className="text-secondary-foreground hover:text-secondary-foreground block max-w-[8rem] truncate hover:underline sm:max-w-[14rem]"
                      >
                        {crumb.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast && (
                    <BreadcrumbSeparator
                      className={`text-secondary-foreground ${mobileVisibility}`}
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
              aria-label="User account menu"
            >
              <span className="flex items-center gap-2 sm:gap-3">
                <span className="hidden flex-col items-end sm:flex">
                  <span className="max-w-[12rem] truncate font-semibold text-white">
                    {`${user.firstName} ${user.lastName}`}
                  </span>
                  <div className="ml-2 flex items-center gap-2 text-right sm:gap-4">
                    {user.isAdmin && <Badge role="ADMIN" className="text-xs" />}
                  </div>
                </span>
                <Avatar className="h-11 w-11" aria-label="User avatar">
                  <AvatarImage 
                    src={`/api/uploads/pfps/${user.avatar}`}
                    alt={`${user.firstName} ${user.lastName}`} />
                  <AvatarFallback className="text-sm text-white">
                    {getInitials(user.firstName, user.lastName, user.email)}
                  </AvatarFallback>
                </Avatar>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem>
              <span className="flex w-full items-center gap-2 text-left cursor-pointer">
                <UserRound className="h-4 w-4" />
                User Account
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left cursor-pointer"
                onClick={() => setEditProfileOpen(true)}
              >
                <UserPen className="h-4 w-4" />
                Edit Profile
              </button>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left cursor-pointer"
                onClick={() => setChangePasswordOpen(true)}
              >
                <LockKeyhole className="h-4 w-4" />
                Change Password
              </button>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left cursor-pointer"
                onClick={() => void safeSignOut({ callbackUrl: '/' })}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="hover:bg-background bg-card text-foreground border-card-foreground/10 border-2 cursor-pointer"
            >
              <Sun className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
              <Moon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
              <span className="sr-only">Toggle theme</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
    <ChangePasswordDialog open={changePasswordOpen} setOpen={setChangePasswordOpen} onChangePassword={() => Promise.resolve()} />
    <EditProfileDialog user={user} open={editProfileOpen} setOpen={setEditProfileOpen} />
  </div>
  );
};

export default Navbar;
