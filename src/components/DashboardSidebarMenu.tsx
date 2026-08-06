'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { useChangePassword } from '@/hooks/use-change-password';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import dynamic from 'next/dynamic';
import { safeSignOut } from '@/lib/safe-signout';
import { getCourseDateBucket } from '@/lib/course-status';
import CollapsedCoursesFlyout from '@/components/CollapsedCoursesFlyout';

/**
 * On demand, for the same reason as the navbar's copies: the sidebar is in the dashboard
 * layout, so a static import here puts zod and react-hook-form in the chunk every dashboard
 * route shares. Both entry points have to be dynamic or the shared chunk keeps them anyway.
 *
 * The mount flags below are load-bearing: `next/dynamic` fetches as soon as the component
 * renders, so rendering these with `open={false}` would defeat it.
 */
const ChangePasswordDialog = dynamic(
  () => import('./dialogs/ChangePasswordDialog').then((m) => m.ChangePasswordDialog),
  { ssr: false },
);
const EditProfileDialog = dynamic(
  () => import('./dialogs/EditProfileDialog').then((m) => m.EditProfileDialog),
  { ssr: false },
);

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
  CircleCheckBig,
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
  'text-sidebar-foreground hover:bg-brand-teal focus-visible:bg-brand-teal active:bg-brand-teal data-[active=true]:bg-brand-teal data-[active=true]:text-white';

type Course = {
  id: string;
  name: string;
  code: string;
  isPublished: boolean;
  isArchived: boolean;
  startDate: string;
  endDate: string;
};

// The dated sidebar course sections, in display order. Archived courses are folded into
// Past Courses (they are finished too), which also carries the Archived Courses page
// link. A section is hidden when it has nothing to show, and courses within a section are
// alphabetized by code.
// `flyoutLabel` is the shorter heading used in the collapsed rail's Courses flyout, where
// the panel is already titled Courses and repeating the word in every group reads as noise.
const COURSE_SECTIONS = [
  { bucket: 'upcoming', label: 'Upcoming Courses', flyoutLabel: 'Upcoming' },
  { bucket: 'current', label: 'Current Courses', flyoutLabel: 'Current' },
  { bucket: 'past', label: 'Past Courses', flyoutLabel: 'Past Courses' },
] as const;

// Static admin menu items (kept alphabetical by title)
const adminMenu = [
  { title: 'Autograder', url: '/dashboard/autograder', icon: CircleCheckBig },
  { title: 'Courses', url: '/dashboard/courses', icon: Book },
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

// The only sections that persist state. Anything else in storage (a stale id from a
// renamed section, or hand-edited junk) is discarded rather than trusted.
const PERSISTED_SECTION_IDS = new Set(['admin', 'upcoming', 'current', 'past']);

/** Keep only known section ids with boolean values. */
function sanitizeSectionState(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (PERSISTED_SECTION_IDS.has(key) && typeof value === 'boolean') out[key] = value;
  }
  return out;
}

function useSidebarSections() {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  // Load persisted state after mount so the server render (all-open) and the first
  // client render match; a persisted-collapsed section then settles closed.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_SECTIONS_KEY);
      if (raw) setOpenMap(sanitizeSectionState(JSON.parse(raw)));
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
      {/* The toggle sits inside a heading (WAI-ARIA accordion pattern) so screen reader
          users can jump between sidebar sections by heading, not just by button.
          Tailwind's preflight strips the h3's default margin/size, so this is
          semantics-only with no visual change. */}
      {/* px-0 drops the label's own horizontal padding so the inner button spans the
          full group width; the button then carries p-2 itself, matching a nav item's
          box exactly so their hover highlights line up edge-to-edge. */}
      <SidebarGroupLabel asChild className="text-sidebar-foreground px-0 text-sm">
        <h3>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={contentId}
            className="hover:bg-brand-teal flex h-full w-full items-center gap-1 rounded-md p-2 whitespace-nowrap"
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
        </h3>
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

// One sidebar link. In the icon rail the label is hidden and surfaced as a tooltip
// instead, so every nav row renders identically wherever it appears.
function SidebarNavItem({
  href,
  label,
  ariaLabel,
  icon: Icon,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  ariaLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarMenuItem>
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarMenuButton asChild isActive={active} className={cn(menuButtonStyles)}>
              <Link
                href={href}
                aria-label={ariaLabel ?? label}
                aria-current={active ? 'page' : undefined}
                // The dashboard layout persists across routes, so the mobile drawer would
                // otherwise stay open on top of the page the user just navigated to.
                onClick={() => {
                  if (isMobile) setOpenMobile(false);
                }}
                className="flex min-w-0 items-center gap-2"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span
                  aria-hidden={collapsed}
                  className={
                    collapsed ? 'hidden' : 'overflow-hidden text-ellipsis whitespace-nowrap'
                  }
                >
                  {label}
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
            {label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </SidebarMenuItem>
  );
}

export default function DashboardSidebarMenu() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const changePassword = useChangePassword();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  // Set on first open and never cleared: see the dynamic imports above.
  const [changePasswordMounted, setChangePasswordMounted] = useState(false);
  const [editProfileMounted, setEditProfileMounted] = useState(false);
  const openChangePassword = () => {
    setChangePasswordMounted(true);
    setChangePasswordOpen(true);
  };
  const openEditProfile = () => {
    setEditProfileMounted(true);
    setEditProfileOpen(true);
  };

  // Cached courses list for sidebar nav, fetched client-side and revalidated.
  const {
    data: courses = [],
    isPending: coursesPending,
    isError: coursesFailed,
    refetch: refetchCourses,
  } = useQuery<Course[]>({
    queryKey: queryKeys.courses.nav(),
    queryFn: async () => {
      const res = await fetch(apiPaths.myCourses({ view: 'nav' }));
      if (!res.ok) throw new Error('Failed to fetch courses');
      return (await res.json()) as Course[];
    },
    staleTime: 30_000,
  });

  const { state, isMobile } = useSidebar();
  // The mobile drawer is a full-width sheet, not the icon rail, so it must always show
  // full labels. Only treat the sidebar as collapsed on desktop, regardless of the saved
  // (desktop) collapse preference.
  const collapsed = state === 'collapsed' && !isMobile;
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

  // The server (nav API) already scopes which courses are returned per the viewer's
  // per-course role. Archived courses are finished, so they sit with the past ones
  // rather than in a section of their own.
  const nonArchived = courses.filter((c) => !c.isArchived);
  const archived = courses.filter((c) => c.isArchived);
  // Admins can view every archived course, so they always get the link. Everyone
  // else (students, faculty, TAs) only sees it when they're a member of an
  // archived course; the nav list is already scoped to the viewer's courses, so
  // an archived entry here means exactly that.
  const showArchivedCoursesLink = isAdmin || archived.length > 0;
  const coursesByBucket: Record<string, Course[]> = {
    upcoming: nonArchived.filter((c) => getCourseDateBucket(c) === 'upcoming'),
    current: nonArchived.filter((c) => getCourseDateBucket(c) === 'current'),
    past: [...nonArchived.filter((c) => getCourseDateBucket(c) === 'past'), ...archived],
  };
  const courseSections = COURSE_SECTIONS.map((section) => ({
    ...section,
    courses: (coursesByBucket[section.bucket] ?? [])
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code)),
  })).filter(
    (section) =>
      // Past Courses also hosts the Archived Courses link, so it stays visible whenever
      // that link does (always for admins) even with no past courses of its own.
      section.courses.length > 0 || (section.bucket === 'past' && showArchivedCoursesLink),
  );
  // The section holding the page you are actually on must be open, whatever the stored
  // preference says. Past Courses defaults to collapsed, so navigating straight to a past
  // course (or the archived list) would otherwise hide the very item you are viewing.
  const activeCourseId = pathname.startsWith('/dashboard/courses/')
    ? (pathname.split('/')[3] ?? null)
    : null;
  const activeSectionBucket: string | null =
    pathname === '/dashboard/archived-courses'
      ? 'past'
      : (courseSections.find((s) => s.courses.some((c) => c.id === activeCourseId))?.bucket ??
        null);

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
      {/* Sidebar navigation content. Exposed as the primary navigation landmark so screen
          reader users can jump to it; the shadcn container is otherwise generic divs. */}
      <SidebarContent className="sidebar-scroll" role="navigation" aria-label="Primary">
        {/* Admin menu: system administrators only */}
        {isAdmin && (
          <CollapsibleSidebarGroup
            sectionId="admin"
            label="Administration"
            collapsed={collapsed}
            open={isOpen('admin')}
            onToggle={() => toggle('admin')}
          >
            <SidebarMenu>
              {resolvedAdminMenu.map(({ title, url, icon }) => (
                <SidebarNavItem
                  key={url}
                  href={url}
                  label={title}
                  icon={icon}
                  active={pathname === url}
                  collapsed={collapsed}
                />
              ))}
            </SidebarMenu>
          </CollapsibleSidebarGroup>
        )}

        {/* Course sections: bucketed by date; an empty section is omitted.
            The query status is checked BEFORE the section list, not only when it is
            empty: an admin always has a Past Courses section (it carries the Archived
            Courses link), so a length check alone meant admins never saw the loading
            skeleton or the retry on failure. */}
        {coursesPending || coursesFailed || courseSections.length === 0
          ? !collapsed && (
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {/* Loading, failed and genuinely-empty are three different states;
                        showing "No courses" for all three both flashed on first load and
                        hid failures behind a plausible-looking answer. */}
                    {coursesPending ? (
                      <SidebarMenuItem>
                        <div
                          className="flex w-full flex-col gap-2 px-2 py-1.5"
                          role="status"
                          aria-label="Loading courses"
                        >
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              aria-hidden="true"
                              className="bg-sidebar-foreground/10 h-4 w-full animate-pulse rounded"
                            />
                          ))}
                        </div>
                      </SidebarMenuItem>
                    ) : coursesFailed ? (
                      <SidebarMenuItem>
                        <div
                          role="alert"
                          className="flex w-full flex-col items-start gap-1 px-2 py-1.5"
                        >
                          <span className="text-sidebar-foreground/70 text-sm">
                            Could not load courses.
                          </span>
                          <button
                            type="button"
                            onClick={() => void refetchCourses()}
                            className="text-sidebar-foreground focus-visible:ring-ring rounded text-sm underline focus-visible:ring-2 focus-visible:outline-none"
                          >
                            Retry
                          </button>
                        </div>
                      </SidebarMenuItem>
                    ) : (
                      <SidebarMenuItem>
                        {/* Plain text, not a button: aria-disabled on a generic div is
                            invalid and this is not an interactive control. */}
                        <div className="text-sidebar-foreground/60 flex w-full items-center gap-2 px-2 py-1.5 text-sm">
                          <Book aria-hidden="true" className="h-4 w-4 shrink-0" />
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                            No courses
                          </span>
                        </div>
                      </SidebarMenuItem>
                    )}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )
          : collapsed ? (
              // In the icon rail the per-course items collapse into one Courses button:
              // every course otherwise showed the same book icon, so they could only be
              // told apart by hovering each in turn.
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <CollapsedCoursesFlyout
                      sections={courseSections.map((section) => ({
                        bucket: section.bucket,
                        label: section.flyoutLabel,
                        courses: section.courses,
                      }))}
                      activeCourseId={activeCourseId}
                      pathname={pathname}
                      showArchivedCoursesLink={showArchivedCoursesLink}
                      // The expanded sidebar's own rule and its own stored state, so a
                      // group is folded the same way in both views: open unless closed by
                      // the user, and always open when it holds the course you are on.
                      isSectionOpen={(bucket) => isOpen(bucket) || bucket === activeSectionBucket}
                      onToggleSection={toggle}
                    />
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
                open={isOpen(section.bucket) || section.bucket === activeSectionBucket}
                onToggle={() => toggle(section.bucket)}
              >
                <SidebarMenu>
                  {section.courses.map((course) => (
                    <SidebarNavItem
                      key={course.id}
                      href={`/dashboard/courses/${course.id}`}
                      label={course.code}
                      ariaLabel={`${course.code}: ${course.name}`}
                      icon={Book}
                      active={pathname.startsWith(`/dashboard/courses/${course.id}`)}
                      collapsed={collapsed}
                    />
                  ))}

                  {/* The archived-courses page lives with the past courses. Always for
                      admins; others only when they're in an archived course. */}
                  {section.bucket === 'past' && showArchivedCoursesLink && (
                    <SidebarNavItem
                      href="/dashboard/archived-courses"
                      label="Archived Courses"
                      icon={Library}
                      active={pathname === '/dashboard/archived-courses'}
                      collapsed={collapsed}
                    />
                  )}
                </SidebarMenu>
              </CollapsibleSidebarGroup>
            ))}

        {/* Calendar is a single destination, so it is a plain top-level link rather than
            a collapsible section wrapping one item. */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarNavItem
                href="/dashboard/calendar"
                label="Calendar"
                icon={Calendar}
                active={pathname === '/dashboard/calendar'}
                collapsed={collapsed}
              />
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
                <SidebarMenuButton
                  // Without this the button's name was the user's name twice (avatar alt
                  // plus the visible span) and never said what activating it does.
                  aria-label={`Open account menu for ${user.name}`}
                  className={cn(
                    'hover:bg-brand-teal data-[state=open]:bg-brand-teal/70 bg-sidebar-foreground/10 h-14 px-3 py-3 transition-colors data-[state=open]:text-white',
                    // In the icon rail the button shrinks to 32px; drop the padding and
                    // center so the 32px avatar fills the tile as a clean circle instead
                    // of overflowing an 8px-padded 16px box behind the (hidden) name.
                    'group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!p-0',
                  )}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    {/* Decorative: the button carries the name, so an alt here would only
                        duplicate it. */}
                    <AvatarImage
                      src={user.avatar ? apiPaths.files.pfp(user.avatar) : undefined}
                      alt=""
                      cropX={user.cropX ?? 0.5}
                      cropY={user.cropY ?? 0.5}
                      zoom={user.zoom ?? 1}
                    />
                    <AvatarFallback className="text-xs">
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
                <DropdownMenuLabel className="[&_svg:not([class*='text-'])]:text-muted-foreground font-normal">
                  <span className="flex w-full items-center gap-2 text-left">
                    <UserRound className="h-4 w-4" />
                    User Account
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer" onClick={openEditProfile}>
                  <UserPen className="h-4 w-4" />
                  Edit Profile
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={openChangePassword}>
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

      {/* Modals, mounted on first use. Rendering them unconditionally would fetch their chunk
          on every page load and undo the point of the dynamic import above. */}
      {changePasswordMounted && (
        <ChangePasswordDialog
          open={changePasswordOpen}
          setOpen={setChangePasswordOpen}
          onChangePassword={changePassword}
        />
      )}

      {editProfileMounted && (
        <EditProfileDialog user={user} open={editProfileOpen} setOpen={setEditProfileOpen} />
      )}
    </>
  );
}
