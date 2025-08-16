'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';

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

import { Book, User, UserRound, LogOut, LockKeyhole, UserPen, ChevronUp } from 'lucide-react';

type Course = {
  id: string;
  name: string;
  code: string;
  isPublished: boolean;
  faculty: { id: string }[];
  tas: { id: string }[];
  students: { id: string }[];
};

// Static admin menu items
const adminMenu = [
  { title: 'Courses', url: '/dashboard/courses', icon: Book },
  { title: 'User Accounts', url: '/dashboard/users', icon: User },
];

// Filter courses based on user role
function getCoursesForUser(
  user: { id: string; role: 'ADMIN' | 'FACULTY' | 'TA' | 'STUDENT' },
  courses: Course[],
) {
  switch (user.role) {
    case 'ADMIN':
      return courses.filter((c) => c.isPublished);
    case 'FACULTY':
      return courses.filter((c) => c.faculty.some((f) => f.id === user.id));
    case 'TA':
      return courses.filter((c) => c.tas.some((t) => t.id === user.id));
    case 'STUDENT':
      return courses.filter((c) => c.isPublished && c.students.some((s) => s.id === user.id));
    default:
      return [];
  }
}

export default function DashboardSidebarMenu() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  const { state } = useSidebar();
  const collapsed = state === 'collapsed';

  // Fetch all courses (used for sidebar display)
  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const res = await fetch('/api/courses');
        if (!res.ok) throw new Error('Failed to fetch courses');
        const data = await res.json();
        setCourses(data);
      } catch (err) {
        console.error('Sidebar fetch error:', err);
        setCourses([]);
      }
    };
    fetchCourses();
  }, []);

  if (!session?.user) return null;

  const {
    id = '',
    email = '',
    name = '',
    firstName = '',
    lastName = '',
    avatar = '',
    role = 'STUDENT',
  } = session.user;

  // Resolve display name and avatar
  const resolvedName =
    name ||
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    email?.split('@')[0] ||
    'User';
  const initials = (firstName?.[0] ?? '') + (lastName?.[0] ?? '') || resolvedName[0] || 'U';
  const avatarUrl = avatar?.trim() !== '' ? `/uploads/${avatar}` : '/default-avatar.png';

  const user = {
    id,
    name: resolvedName,
    email,
    avatarUrl,
    initials,
    role: role?.toUpperCase?.() || 'STUDENT',
  };

  const filteredCourses = getCoursesForUser(user, courses);

  return (
    <>
      {/* Sidebar navigation content */}
      <SidebarContent>
        {/* Admin menu */}
        {(user.role === 'ADMIN' || user.role === 'FACULTY') && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground text-sm">
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
                              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
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
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground text-sm">
            Current Courses
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredCourses.map((course) => (
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
                            <span className="overflow-hidden text-ellipsis whitespace-nowrap">
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
              ))}
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
      <EditProfileDialog open={editProfileOpen} setOpen={setEditProfileOpen} />
    </>
  );
}
