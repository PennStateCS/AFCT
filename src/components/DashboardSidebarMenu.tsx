'use client';

// FIXME

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { safeSignOut } from '@/lib/safe-signout';

import { ChangePasswordDialog } from './dialogs/ChangePasswordDialog';
import { EditProfileDialog } from './dialogs/EditProfileDialog';

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import {
  Calendar,
  Library,
  Book,
  Users,
  UserRound,
  Layers,
  LogOut,
  Logs,
  LockKeyhole,
  UserPen,
  ChevronUp,
  Activity,
  Settings,
  Wrench,
} from 'lucide-react';

const menuButtonStyles =
  'text-sidebar-foreground hover:bg-secondary/85 focus-visible:bg-secondary/85 active:bg-secondary data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground';

type Course = {
  id: string;
  name: string;
  code: string;
  isPublished: boolean;
  isArchived: boolean;
};

// Static admin menu items
const adminMenu = [
  { title: 'Courses', url: '/dashboard/courses', icon: Book },
  { title: 'User Accounts', url: '/dashboard/users', icon: Users },
  { title: 'Submission Logs', url: '/dashboard/submissions', icon: Layers },
  { title: 'System Status', url: '/dashboard/system-status', icon: Activity },
  { title: 'System Settings', url: '/dashboard/system-settings', icon: Settings },
  { title: 'System Logs', url: '/dashboard/system-logs', icon: Logs },
];

export default function DashboardSidebarMenu() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  // Use SWR for client-side data fetching and revalidation
  const fetcher = (url: string) =>
    fetch(url).then((res) => {
      if (!res.ok) throw new Error('Failed to fetch courses');
      return res.json();
    });
  const { data: courses = [] } = useSWR<Course[]>('/api/courses/nav', fetcher, {
    refreshInterval: 0,
    revalidateOnFocus: true, // revalidate when window/tab is focused
  });

  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  if (!session?.user) return null;

  const {
    id = '',
    email = '',
    name = '',
    firstName = '',
    lastName = '',
    avatar = '',
    timezone,
    role = 'STUDENT',
  } = session.user;

  // Resolve display name and avatar
  const resolvedName =
    name ||
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    email?.split('@')[0] ||
    'User';
  const initials = (firstName?.[0] ?? '') + (lastName?.[0] ?? '') || resolvedName[0] || 'U';
  const avatarUrl = avatar?.trim() !== '' ? avatar : null;

  const user = {
    id,
    firstName: firstName,
    lastName: lastName,
    name: resolvedName,
    email,
    avatar: avatarUrl,
    timezone: timezone ?? null,
    initials,
    role: (role?.toUpperCase?.() || 'STUDENT') as 'ADMIN' | 'FACULTY' | 'TA' | 'STUDENT',
    password: '', // password is not exposed from session
    temporaryPassword: Boolean(session.user.mustChangePassword),
    inactive: false, // inactive status is not exposed from session
    createdAt: new Date(), // createdAt is not exposed from session
    updatedAt: new Date(), // updatedAt is not exposed from session
  };

  const visibleCourses = courses.filter((c) => {
    if (c.isArchived) return false;
    if (user.role === 'STUDENT') return c.isPublished;
    return true;
  });
  const isDev = process.env.NODE_ENV !== 'production';
  const resolvedAdminMenu = isDev
    ? [
        ...adminMenu,
        { title: 'Development Tests', url: '/dashboard/development-tests', icon: Wrench },
      ]
    : adminMenu;

  return (
    <>
      {/* Sidebar navigation content */}
      <SidebarContent>
        {/* Admin menu */}
        {(user.role === 'ADMIN' || user.role === 'FACULTY') && (
          <SidebarGroup>
            <SidebarGroupLabel
              aria-hidden={collapsed}
              className={
                collapsed
                  ? 'hidden'
                  : 'text-sidebar-foreground overflow-hidden text-sm whitespace-nowrap'
              }
            >
              Admin Menu
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {resolvedAdminMenu.map(({ title, url, icon: Icon }) => (
                  <SidebarMenuItem key={url}>
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <SidebarMenuButton
                            asChild
                            isActive={pathname === url}
                            className={cn(menuButtonStyles)}
                          >
                            <Link
                              href={url}
                              aria-label={title}
                              className="flex min-w-0 items-center gap-2"
                            >
                              <Icon className="h-4 w-4 shrink-0" />
                              <span
                                aria-hidden={collapsed}
                                className={
                                  collapsed
                                    ? 'hidden'
                                    : 'overflow-hidden text-ellipsis whitespace-nowrap'
                                }
                              >
                                {title}
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
                          {title}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Courses menu */}
        {!(collapsed && visibleCourses.length === 0) && (
          <SidebarGroup>
            <SidebarGroupLabel
              aria-hidden={collapsed}
              className={
                collapsed
                  ? 'hidden'
                  : 'text-sidebar-foreground overflow-hidden text-sm whitespace-nowrap'
              }
            >
              Current Courses
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleCourses.length === 0 ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      aria-disabled={true}
                      className={cn('text-sidebar-foreground/60 cursor-default')}
                    >
                      <div className={cn('flex w-full items-center gap-2')}>
                        <Book className="h-4 w-4 shrink-0" />
                        <span
                          aria-hidden={collapsed}
                          className={
                            collapsed ? 'hidden' : 'overflow-hidden text-ellipsis whitespace-nowrap'
                          }
                        >
                          No courses
                        </span>
                      </div>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  visibleCourses.map((course) => (
                    <SidebarMenuItem key={course.id}>
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton
                              asChild
                              isActive={pathname.startsWith(`/dashboard/courses/${course.id}`)}
                              className={cn(menuButtonStyles)}
                            >
                              <Link
                                href={`/dashboard/courses/${course.id}`}
                                aria-label={`${course.code}: ${course.name}`}
                                className="flex min-w-0 items-center gap-2"
                              >
                                <Book className="h-4 w-4 shrink-0" />
                                <span
                                  aria-hidden={collapsed}
                                  className={
                                    collapsed
                                      ? 'hidden'
                                      : 'overflow-hidden text-ellipsis whitespace-nowrap'
                                  }
                                >
                                  {course.code}
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
                            {course.code}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Features */}
        <SidebarGroup>
          <SidebarGroupLabel
            aria-hidden={collapsed}
            className={
              collapsed
                ? 'hidden'
                : 'text-sidebar-foreground overflow-hidden text-sm whitespace-nowrap'
            }
          >
            Other Pages
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem key="features-calendar">
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === '/dashboard/calendar'}
                        className={cn(menuButtonStyles)}
                      >
                        <Link
                          href="/dashboard/calendar"
                          aria-label="Calendar"
                          className="flex min-w-0 items-center gap-2"
                        >
                          <Calendar className="h-4 w-4 shrink-0" />
                          <span
                            aria-hidden={collapsed}
                            className={
                              collapsed
                                ? 'hidden'
                                : 'overflow-hidden text-ellipsis whitespace-nowrap'
                            }
                          >
                            Calendar
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
                      Calendar
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </SidebarMenuItem>

              {/* Previous Courses */}
              <SidebarMenuItem key="features-previous-courses">
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === '/dashboard/previous-courses'}
                        className={cn(menuButtonStyles)}
                      >
                        <Link
                          href="/dashboard/previous-courses"
                          aria-label="Previous Courses"
                          className="flex min-w-0 items-center gap-2"
                        >
                          <Library className="h-4 w-4 shrink-0" />
                          <span
                            aria-hidden={collapsed}
                            className={
                              collapsed
                                ? 'hidden'
                                : 'overflow-hidden text-ellipsis whitespace-nowrap'
                            }
                          >
                            Previous Courses
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
                      Previous Courses
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer menu for user account actions */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton className="hover:bg-secondary data-[state=open]:bg-secondary/70 data-[state=open]:text-secondary-foreground h-14 bg-[#525252] px-3 py-3 transition-colors">
                  <UserRound /> {user.name}
                  <ChevronUp className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" className="w-[var(--radix-popper-anchor-width)]">
                <DropdownMenuItem>
                  <span className="flex w-full items-center gap-2 text-left">
                    <UserRound className="h-4 w-4" />
                    User Account
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-left"
                    onClick={() => setEditProfileOpen(true)}
                  >
                    <UserPen className="h-4 w-4" />
                    Edit Profile
                  </button>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 text-left"
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
                    className="flex w-full items-center gap-2 text-left"
                    onClick={() => void safeSignOut({ callbackUrl: '/' })}
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Modals */}
      <ChangePasswordDialog
        open={changePasswordOpen}
        setOpen={setChangePasswordOpen}
        onChangePassword={async (oldPassword, newPassword) => {
          const res = await fetch('/api/users/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPassword, newPassword }),
          });
          if (!res.ok) {
            const { error } = await res.json();
            toast.error(error || 'Failed to change password');
            throw new Error(error || 'Failed to change password');
          }
          toast.success('Password changed!');
        }}
      />
      <EditProfileDialog user={user} open={editProfileOpen} setOpen={setEditProfileOpen} />
    </>
  );
}
