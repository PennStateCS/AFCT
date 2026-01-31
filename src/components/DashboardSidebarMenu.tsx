'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { isEnrolled } from '@/lib/course-utils';

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
  Archive,
  Calendar,
  Library,
  Book,
  Users,
  UserRound,
  LogOut,
  LockKeyhole,
  UserPen,
  ChevronUp,
  BookPlus,
  Settings,
} from 'lucide-react';

type Course = {
  id: string;
  name: string;
  code: string;
  isPublished: boolean;
  isArchived: boolean;
  // enrolled is a list of user objects (with `courseRole`) for all roster members
  enrolled?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    avatar?: string | null;
    courseRole?: string;
  }[];
};

// Static admin menu items
const adminMenu = [
  { title: 'Courses', url: '/dashboard/courses', icon: Book },
  { title: 'User Accounts', url: '/dashboard/users', icon: Users },
  { title: 'System Status', url: '/dashboard/system-status', icon: BookPlus },
  { title: 'System Settings', url: '/dashboard/system-settings', icon: Settings },
];

// Filter courses based on user role
function getCoursesForUser(
  user: { id: string; role: 'ADMIN' | 'FACULTY' | 'TA' | 'STUDENT' },
  courses: Course[],
) {
  // Should only see published courses even if enrolled.
  return courses.filter((c) => {
    const enrolled = c.enrolled ?? [];
    const isEnr = isEnrolled(enrolled as any, user.id);
    if (!isEnr) return false;
    if (user.role === 'STUDENT') return c.isPublished;
    return true;
  });
}

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
  const { data: courses = [] } = useSWR<Course[]>('/api/courses', fetcher, {
    refreshInterval: 6000, // revalidate every 6s
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
    inactive: false, // inactive status is not exposed from session
    createdAt: new Date(), // createdAt is not exposed from session
    updatedAt: new Date(), // updatedAt is not exposed from session
  };

  const filteredCourses = getCoursesForUser(user, courses);
  const visibleCourses = filteredCourses.filter((c) => !c.isArchived);

  return (
    <>
      {/* Sidebar navigation content */}
      <SidebarContent>
        {/* Admin menu */}
        {(user.role === 'ADMIN' || user.role === 'FACULTY') && (
          <SidebarGroup>
            <SidebarGroupLabel
              aria-hidden={collapsed}
              className={collapsed ? 'hidden' : 'text-sidebar-foreground text-sm'}
            >
              Admin Menu
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminMenu.map(({ title, url, icon: Icon }) => (
                  <SidebarMenuItem key={url}>
                    <TooltipProvider delayDuration={100}>
                      <Tooltip open={collapsed ? undefined : false}>
                        <TooltipTrigger asChild>
                          <SidebarMenuButton
                            asChild
                            isActive={pathname === url}
                            className={cn(
                              'hover:bg-secondary focus:bg-secondary text-sidebar-foreground',
                              'data-[active=true]:bg-secondary',
                            )}
                          >
                            <Link href={url} className="flex min-w-0 items-center gap-2">
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
              className={collapsed ? 'hidden' : 'text-sidebar-foreground text-sm'}
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
                        <Tooltip open={collapsed ? undefined : false}>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton
                              asChild
                              isActive={pathname.startsWith(`/dashboard/courses/${course.id}`)}
                              className={cn(
                                'hover:bg-secondary focus:bg-secondary text-sidebar-foreground',
                                'data-[active=true]:bg-secondary',
                              )}
                            >
                              <Link
                                href={`/dashboard/courses/${course.id}`}
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
            className={collapsed ? 'hidden' : 'text-sidebar-foreground text-sm'}
          >
            Features
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem key="features-calendar">
                <TooltipProvider delayDuration={100}>
                  <Tooltip open={collapsed ? undefined : false}>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === '/dashboard/calendar'}
                        className={cn(
                          'hover:bg-secondary focus:bg-secondary text-sidebar-foreground',
                          'data-[active=true]:bg-secondary',
                        )}
                      >
                        <Link
                          href="/dashboard/calendar"
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
                      className="bg-sidebar text-sidebar-foreground px-5 text-sm shadow"
                      sideOffset={10}
                    >
                      Calendar
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Course Displays */}
        <SidebarGroup>
          <SidebarGroupLabel
            aria-hidden={collapsed}
            className={collapsed ? 'hidden' : 'text-sidebar-foreground text-sm'}
          >
            Course Displays
          </SidebarGroupLabel>
          <SidebarMenu>
            {/* The Archive */}
            <SidebarMenuItem>
              <TooltipProvider delayDuration={100}>
                <Tooltip open={collapsed ? undefined : false}>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === '/dashboard/archive'}
                      className={cn(
                        'hover:bg-secondary focus:bg-secondary text-sidebar-foreground',
                        'data-[active=true]:bg-secondary',
                      )}
                    >
                      <Link href="/dashboard/archive" className="flex min-w-0 items-center gap-2">
                        <Archive className="h-4 w-4 shrink-0" />
                        <span
                          aria-hidden={collapsed}
                          className={
                            collapsed ? 'hidden' : 'overflow-hidden text-ellipsis whitespace-nowrap'
                          }
                        >
                          Archived Courses
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="bg-sidebar text-sidebar-foreground px-5 text-sm shadow"
                    sideOffset={10}
                  >
                    Archived Courses
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </SidebarMenuItem>

            {/* All Courses */}
            <SidebarMenuItem>
              <TooltipProvider delayDuration={100}>
                <Tooltip open={collapsed ? undefined : false}>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === '/dashboard/all-courses'}
                      className={cn(
                        'hover:bg-secondary focus:bg-secondary text-sidebar-foreground',
                        'data-[active=true]:bg-secondary',
                      )}
                    >
                      <Link
                        href="/dashboard/all-courses"
                        className="flex min-w-0 items-center gap-2"
                      >
                        <Library className="h-4 w-4 shrink-0" />
                        <span
                          aria-hidden={collapsed}
                          className={
                            collapsed ? 'hidden' : 'overflow-hidden text-ellipsis whitespace-nowrap'
                          }
                        >
                          All Courses
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="bg-sidebar text-sidebar-foreground px-5 text-sm shadow"
                    sideOffset={10}
                  >
                    All Courses
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </SidebarMenuItem>
          </SidebarMenu>
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
                    onClick={() => signOut({ callbackUrl: '/' })}
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
