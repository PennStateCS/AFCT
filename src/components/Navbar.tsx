'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/RoleBadge';
import { useNavbarBreadcrumbs } from '@/components/navbar/NavbarBreadcrumbContext';

// UI Components
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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

  const toTitleCase = (value: string) =>
    value
      .split('-')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

  const segments = pathname.split('/').filter(Boolean);
  const dashboardIndex = segments.indexOf('dashboard');
  const dashboardSegments = dashboardIndex >= 0 ? segments.slice(dashboardIndex + 1) : segments;

  const crumbs: Array<{ href: string; label: string; isPage?: boolean }> = [
    { href: '/dashboard', label: 'Dashboard', isPage: dashboardSegments.length === 0 },
  ];

  if (dashboardSegments[0] === 'courses') {
    crumbs.push({
      href: '/dashboard/courses',
      label: 'Courses',
      isPage: dashboardSegments.length === 1,
    });

    const courseId = dashboardSegments[1];
    if (courseId) {
      crumbs.push({
        href: `/dashboard/courses/${courseId}`,
        label: courseLabel?.id === courseId ? courseLabel.name : toTitleCase(courseId),
        isPage: dashboardSegments.length === 2,
      });
    }

    const assignmentId = dashboardSegments[2];
    if (assignmentId) {
      crumbs.push({
        href: `/dashboard/courses/${courseId}/${assignmentId}`,
        label:
          assignmentLabel?.id === assignmentId ? assignmentLabel.title : toTitleCase(assignmentId),
        isPage: dashboardSegments.length === 3,
      });
    }
  } else if (dashboardSegments[0] !== undefined) {
    let hrefAcc = '/dashboard';
    dashboardSegments.forEach((segment, index) => {
      hrefAcc = `${hrefAcc}/${segment}`;
      crumbs.push({
        href: hrefAcc,
        label: toTitleCase(segment),
        isPage: index === dashboardSegments.length - 1,
      });
    });
  }

  if (status === 'loading') {
    return (
      <nav className="bg-secondary mb-4 flex h-16 items-center justify-between rounded-lg p-4 text-white shadow-sm" />
    );
  }

  if (!data?.user) return null;

  const { firstName, lastName, role, avatar } = data.user;
  const roleDisplay = role || 'STUDENT';
  const avatarUrl = avatar ? `/api/uploads/pfps/${avatar}` : '/api/uploads/pfps/default-avatar.png';

  // Use session.user.name first (which is built from firstName + lastName in auth)
  // Then fallback to building it from individual fields, then fallback to 'User'
  const fullName = data.user.name || [firstName, lastName].filter(Boolean).join(' ') || 'User';

  return (
    <nav className="bg-secondary mb-4 flex h-16 items-center justify-between rounded-lg p-4 text-white shadow-sm">
      <div className="flex items-center gap-4">
        <EnhancedSidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList className="text-sm">
            {crumbs.map((crumb) => {
              const isLast = !!crumb.isPage;

              return (
                <React.Fragment key={crumb.href}>
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage className="text-white">{crumb.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        href={crumb.href}
                        className="text-secondary-foreground hover:text-secondary-foreground hover:underline"
                      >
                        {crumb.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator className="text-secondary-foreground" />}
                </React.Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <div className="flex items-center gap-4 text-right">
        <div className="flex flex-col items-end">
          <div className="font-medium">{fullName}</div>
          <Badge role={roleDisplay} className="text-xs" />
        </div>

        <Avatar className="h-11 w-11" aria-label="User avatar">
          <AvatarImage src={avatarUrl} alt={`${fullName}'s avatar`} />
          <AvatarFallback>
            {firstName?.[0]}
            {lastName?.[0]}
          </AvatarFallback>
        </Avatar>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="hover:text-red hover:bg-background bg-card text-foreground border-secondary-foreground/40 border-2"
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
  );
};

export default Navbar;
