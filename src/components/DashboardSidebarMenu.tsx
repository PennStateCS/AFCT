'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { apiPaths } from '@/lib/api-paths';
import { safeSignOut } from '@/lib/safe-signout';
import { getCourseDateBucket } from '@/lib/course-status';

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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

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
  ChevronDown,
  Activity,
  Settings,
  Wrench,
} from 'lucide-react';
import { getInitials } from '@/app/utils/initials';

const menuButtonStyles =
  'text-sidebar-foreground hover:bg-secondary focus-visible:bg-secondary active:bg-secondary data-[active=true]:bg-secondary data-[active=true]:text-secondary-foreground';

type Course = {
  id: string;
  name: string;
  code: string;
  isPublished: boolean;
  isArchived: boolean;
  startDate: string;
  endDate: string;
};

// The dated sidebar course sections, in display order. Archived courses are
// excluded (they live on the Archived Courses page); each section is hidden when
// it has no courses, and courses within a section are alphabetized by code.
const COURSE_SECTIONS = [
  { bucket: 'upcoming', label: 'Upcoming Courses' },
  { bucket: 'current', label: 'Current Courses' },
  { bucket: 'past', label: 'Past Courses' },
] as const;

// Static admin menu items (kept alphabetical by title)
const adminMenu = [
  { title: 'Courses', url: '/dashboard/courses', icon: Book },
  { title: 'Submission Logs', url: '/dashboard/submissions', icon: Layers },
  { title: 'System Logs', url: '/dashboard/system-logs', icon: Logs },
  { title: 'System Settings', url: '/dashboard/system-settings', icon: Settings },
  { title: 'System Status', url: '/dashboard/system-status', icon: Activity },
  { title: 'User Accounts', url: '/dashboard/users', icon: Users },
];

// Persisted per-section expand/collapse state. One localStorage entry holds a
// { sectionId: isOpen } map; a section defaults to open when it has no stored value,
// except Past Courses, which starts collapsed since it's the least-used section.
const SIDEBAR_SECTIONS_KEY = 'afct.sidebarSections';
const SECTION_DEFAULT_OPEN: Record<string, boolean> = { past: false };

function useSidebarSections() {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  // Load persisted state after mount so the server render (all-open) and the first
  // client render match; a persisted-collapsed section then settles closed.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_SECTIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setOpenMap(parsed as Record<string, boolean>);
      }
    } catch {
      // ignore malformed/unavailable storage
    }
  }, []);

  const isOpen = useCallback(
    (id: string) => openMap[id] ?? SECTION_DEFAULT_OPEN[id] ?? true,
    [openMap],
  );

  const toggle = useCallback((id: string) => {
    setOpenMap((prev) => {
      // Flip from the section's *effective* current state (honoring per-section
      // defaults) so the first click on a default-collapsed section expands it.
      const next = { ...prev, [id]: !(prev[id] ?? SECTION_DEFAULT_OPEN[id] ?? true) };
      try {
        localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors (e.g. private mode)
      }
      return next;
    });
  }, []);

  return { isOpen, toggle };
}

// A sidebar section whose label toggles its content open/closed. In the icon-rail
// (sidebar-collapsed) mode there are no labels to click, so the content always shows
// and the collapse affordance is dropped.
function CollapsibleSidebarGroup({
  sectionId,
  label,
  collapsed,
  open,
  onToggle,
  children,
}: {
  sectionId: string;
  label: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const contentId = `sidebar-section-${sectionId}`;

  if (collapsed) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>{children}</SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <SidebarGroup>
      {/* Color/size go on SidebarGroupLabel's className so tailwind-merge overrides its
          dimmed `text-sidebar-foreground/70 text-xs` base, matching the submenu items. */}
      <SidebarGroupLabel asChild className="text-sidebar-foreground text-sm">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={contentId}
          className="hover:bg-secondary/60 flex w-full items-center gap-1 whitespace-nowrap"
        >
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'ml-auto h-4 w-4 shrink-0 transition-transform',
              open ? '' : '-rotate-90',
            )}
          />
        </button>
      </SidebarGroupLabel>
      {/* Kept mounted and toggled with `hidden` so the toggle's aria-controls
          always references an existing element (a conditional render would leave
          it dangling whenever the section is closed). */}
      <SidebarGroupContent id={contentId} hidden={!open}>
        {children}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export default function DashboardSidebarMenu() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  // Cached courses list for sidebar nav, fetched client-side and revalidated.
  const { data: courses = [] } = useQuery<Course[]>({
    queryKey: ['courses', 'nav'],
    queryFn: async () => {
      const res = await fetch(apiPaths.myCourses({ view: 'nav' }));
      if (!res.ok) throw new Error('Failed to fetch courses');
      return (await res.json()) as Course[];
    },
    staleTime: 30_000,
  });

  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { isOpen, toggle } = useSidebarSections();

  if (!session?.user) return null;

  const {
    id = '',
    email = '',
    name = '',
    firstName = '',
    lastName = '',
    avatar = '',
    cropX = 0.5,
    cropY = 0.5,
    zoom = 1,
    timezone,
    isAdmin = false,
  } = session.user;

  // Resolve display name and avatar
  const resolvedName =
    name ||
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    email?.split('@')[0] ||
    'User';
  const avatarUrl = avatar?.trim() !== '' ? avatar : null;

  const user = {
    id,
    firstName: firstName,
    lastName: lastName,
    name: resolvedName,
    email,
    avatar: avatarUrl,
    cropX,
    cropY,
    zoom,
    timezone: timezone ?? null,
    password: '', // password is not exposed from session
    temporaryPassword: Boolean(session.user.mustChangePassword),
    inactive: false, // inactive status is not exposed from session
    createdAt: new Date(), // createdAt is not exposed from session
    updatedAt: new Date(), // updatedAt is not exposed from session
  };

  // The server (nav API) already scopes which courses are returned per the
  // viewer's per-course role; here we only drop archived ones (they live on the
  // Archived Courses page), then bucket by date into the sidebar sections.
  const visibleCourses = courses.filter((c) => !c.isArchived);
  // Admins can view every archived course, so they always get the link. Everyone
  // else (students, faculty, TAs) only sees it when they're a member of an
  // archived course; the nav list is already scoped to the viewer's courses, so
  // an archived entry here means exactly that.
  const showArchivedCoursesLink = isAdmin || courses.some((c) => c.isArchived);
  const courseSections = COURSE_SECTIONS.map((section) => ({
    ...section,
    courses: visibleCourses
      .filter((c) => getCourseDateBucket(c) === section.bucket)
      .sort((a, b) => a.code.localeCompare(b.code)),
  })).filter((section) => section.courses.length > 0);
  const isDev = process.env.NODE_ENV !== 'production';
  const resolvedAdminMenu = (
    isDev
      ? [
          ...adminMenu,
          { title: 'Development Tests', url: '/dashboard/development-tests', icon: Wrench },
        ]
      : adminMenu
  )
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <>
      {/* Sidebar navigation content */}
      <SidebarContent className="sidebar-scroll">
        {/* Admin menu: system administrators only */}
        {isAdmin && (
          <CollapsibleSidebarGroup
            sectionId="admin"
            label="Admin Menu"
            collapsed={collapsed}
            open={isOpen('admin')}
            onToggle={() => toggle('admin')}
          >
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
                              aria-current={pathname === url ? 'page' : undefined}
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
          </CollapsibleSidebarGroup>
        )}

        {/* Course sections: bucketed by date; an empty section is omitted. */}
        {courseSections.length === 0
          ? !collapsed && (
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        aria-disabled={true}
                        className={cn('text-sidebar-foreground/60 cursor-default')}
                      >
                        <div className={cn('flex w-full items-center gap-2')}>
                          <Book className="h-4 w-4 shrink-0" />
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                            No courses
                          </span>
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )
          : courseSections.map((section) => (
              <CollapsibleSidebarGroup
                key={section.bucket}
                sectionId={section.bucket}
                label={section.label}
                collapsed={collapsed}
                open={isOpen(section.bucket)}
                onToggle={() => toggle(section.bucket)}
              >
                  <SidebarMenu>
                    {section.courses.map((course) => (
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
                                  aria-current={
                                    pathname.startsWith(`/dashboard/courses/${course.id}`)
                                      ? 'page'
                                      : undefined
                                  }
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
                    ))}
                  </SidebarMenu>
              </CollapsibleSidebarGroup>
            ))}

        {/* Features */}
        <CollapsibleSidebarGroup
          sectionId="other-pages"
          label="Other Pages"
          collapsed={collapsed}
          open={isOpen('other-pages')}
          onToggle={() => toggle('other-pages')}
        >
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
                          aria-current={pathname === '/dashboard/calendar' ? 'page' : undefined}
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

              {/* Archived Courses: always for admins; others only when enrolled
                  in an archived course */}
              {showArchivedCoursesLink && (
              <SidebarMenuItem key="features-archived-courses">
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === '/dashboard/archived-courses'}
                        className={cn(menuButtonStyles)}
                      >
                        <Link
                          href="/dashboard/archived-courses"
                          aria-label="Archived Courses"
                          aria-current={
                            pathname === '/dashboard/archived-courses' ? 'page' : undefined
                          }
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
                            Archived Courses
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
                      Archived Courses
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </SidebarMenuItem>
              )}
            </SidebarMenu>
        </CollapsibleSidebarGroup>
      </SidebarContent>

      {/* Footer menu for user account actions */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  className={cn(
                    'hover:bg-secondary data-[state=open]:bg-secondary/70 data-[state=open]:text-secondary-foreground h-14 bg-[#525252] px-3 py-3 transition-colors',
                    // In the icon rail the button shrinks to 32px; drop the padding and
                    // center so the 32px avatar fills the tile as a clean circle instead
                    // of overflowing an 8px-padded 16px box behind the (hidden) name.
                    'group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!p-0',
                  )}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage
                      src={user.avatar ? apiPaths.files.pfp(user.avatar) : undefined}
                      alt={user.name}
                      cropX={user.cropX ?? 0.5}
                      cropY={user.cropY ?? 0.5}
                      zoom={user.zoom ?? 1}
                    />
                    <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                      {getInitials(user.firstName, user.lastName, user.email)}
                    </AvatarFallback>
                  </Avatar>
                  {!collapsed && (
                    <>
                      <span className="truncate">{user.name}</span>
                      <ChevronUp className="ml-auto" />
                    </>
                  )}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              {/* min-w (not w) so the menu still fills the trigger when the sidebar is
                  expanded, but grows to fit its items when collapsed (the trigger is
                  then only 32px wide, which would otherwise squish the menu). */}
              <DropdownMenuContent
                side="top"
                className="min-w-[max(var(--radix-popper-anchor-width),12rem)]"
              >
                {/* Section header, not an action. A Label keeps it out of the menu's
                    focus/arrow-key order; overrides preserve the exact resting look. */}
                <DropdownMenuLabel className="font-normal [&_svg:not([class*='text-'])]:text-muted-foreground">
                  <span className="flex w-full items-center gap-2 text-left">
                    <UserRound className="h-4 w-4" />
                    User Account
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => setEditProfileOpen(true)}
                >
                  <UserPen className="h-4 w-4" />
                  Edit Profile
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => setChangePasswordOpen(true)}
                >
                  <LockKeyhole className="h-4 w-4" />
                  Change Password
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
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* Modals */}
      <ChangePasswordDialog
        open={changePasswordOpen}
        setOpen={setChangePasswordOpen}
        onChangePassword={async (oldPassword, newPassword) => {
          const res = await fetch(apiPaths.myPassword(), {
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
