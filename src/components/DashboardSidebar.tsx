'use client';

import { useSession } from 'next-auth/react';
import { ChangePasswordDialog } from './dialogs/ChangePasswordDialog';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  LayoutDashboard,
  Book,
  User,
  UserRound,
  LogOut,
  LockKeyhole,
  UserPen,
  User2,
  ChevronUp,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarHeader,
  SidebarMenuSkeleton,
} from '@/components/ui/sidebar';

import { cn } from '@/lib/utils';

type Course = {
  id: string;
  name: string;
  code: string;
  isPublished: boolean;
  faculty: { id: string }[];
  tas: { id: string }[];
  students: { id: string }[];
};

const adminMenu = [
  { title: 'Courses', url: '/dashboard/courses', icon: Book },
  { title: 'User Accounts', url: '/dashboard/users', icon: User },
];

const footer = [
  { title: 'Edit Profile', url: '/dashboard/profile', icon: UserPen },
  { title: 'Change Password', url: '/dashboard/users/create', icon: LockKeyhole },
  { title: 'Sign Out', url: '/dashboard/courses', icon: LogOut },
];

function getCoursesForUser(
  user: {
    id: string;
    role: 'ADMIN' | 'FACULTY' | 'TA' | 'STUDENT';
  },
  courses: Course[],
) {
  if (user.role === 'ADMIN') return courses;
  if (user.role === 'FACULTY')
    return courses.filter((c) => c.faculty.some((f) => f.id === user.id) && c.isPublished);
  if (user.role === 'TA') return courses.filter((c) => c.tas.some((t) => t.id === user.id));
  if (user.role === 'STUDENT')
    return courses.filter((c) => c.students.some((s) => s.id === user.id) && c.isPublished);
  return [];
}

// Course menu skeleton loader
function CourseList({
  filteredCourses,
  loadingCourses,
  pathname,
}: {
  filteredCourses: Course[];
  loadingCourses: boolean;
  pathname: string;
}) {
  if (loadingCourses) {
    return <SidebarMenuSkeleton />;
  }
  if (filteredCourses.length === 0) {
    return <span className="text-muted-foreground px-2 text-xs">No courses</span>;
  }
  return (
    <>
      {filteredCourses.map((course) => (
        <SidebarMenuItem key={course.id}>
          <SidebarMenuButton
            asChild
            className="hover:bg-secondary focus:bg-secondary active:bg-secondary text-sidebar-foreground"
          >
            <Link
              href={`/dashboard/courses/${course.id}`}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                pathname.startsWith(`/dashboard/courses/${course.id}`) &&
                  'bg-secondary text-sidebar-foreground font-semibold',
              )}
            >
              <Book className="h-4 w-4" />
              <span>{course.code}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </>
  );
}

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loadingAdminMenu, setLoadingAdminMenu] = useState(true);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  useEffect(() => {
    const fetchCourses = async () => {
      setLoadingCourses(true);
      try {
        const res = await fetch('/api/courses');
        if (!res.ok) throw new Error('Failed to fetch courses');
        const data = await res.json();
        setCourses(data);
      } catch (err) {
        setCourses([]);
      } finally {
        setLoadingCourses(false);
      }
    };
    fetchCourses();
  }, []);

  // Simulate loading the admin menu (remove timeout for real API)
  useEffect(() => {
    const timer = setTimeout(() => setLoadingAdminMenu(false), 600);
    return () => clearTimeout(timer);
  }, []);

  if (status === 'loading') return null;
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

  const resolvedName =
    name ||
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    email?.split('@')[0] ||
    'User';
  const initials = (firstName?.[0] ?? '') + (lastName?.[0] ?? '') || resolvedName[0] || 'U';
  const avatarUrl = avatar && avatar.trim() !== '' ? `/uploads/${avatar}` : '/default-avatar.png';

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
      <Sidebar collapsible="icon" className="h-full overflow-x-hidden">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className="hover:bg-secondary focus:bg-secondary active:bg-secondary text-sidebar-foreground text-base"
              >
                <Link
                  href="/dashboard"
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-base',
                    pathname === '/dashboard' &&
                      'bg-secondary text-sidebar-foreground font-semibold',
                  )}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  <span>AFCT Dashboard</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          {(user.role === 'ADMIN' || user.role === 'FACULTY') && (
            <SidebarGroup>
              <SidebarGroupLabel className="text-sidebar-foreground text-sm">
                Admin Menu
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {loadingAdminMenu ? (
                    <SidebarMenuSkeleton />
                  ) : (
                    adminMenu.map(({ title, url, icon: Icon }) => (
                      <SidebarMenuItem key={title}>
                        <SidebarMenuButton
                          asChild
                          className="hover:bg-secondary focus:bg-secondary active:bg-secondary text-sidebar-foreground"
                        >
                          <Link
                            href={url}
                            className={cn(
                              'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                              pathname === url &&
                                'bg-secondary text-sidebar-foreground font-semibold',
                            )}
                          >
                            <Icon />
                            <span>{title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground text-sm">
              Current Courses
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <CourseList
                  filteredCourses={filteredCourses}
                  loadingCourses={loadingCourses}
                  pathname={pathname}
                />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
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
                  <DropdownMenuItem className="hover:bg-secondary hover:text-secondary-foreground focus:bg-secondary focus:text-secondary-foreground">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 text-left"
                      onClick={() => signOut({ callbackUrl: '/' })}
                    >
                      <UserPen className="h-4 w-4" />
                      Edit Profile
                    </button>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="hover:bg-secondary hover:text-secondary-foreground focus:bg-secondary focus:text-secondary-foreground">
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
                  <DropdownMenuItem className="hover:bg-secondary hover:text-secondary-foreground focus:bg-secondary focus:text-secondary-foreground">
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
      </Sidebar>

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
    </>
  );
}
