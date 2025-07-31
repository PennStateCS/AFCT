'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/utils';
import { signOut } from 'next-auth/react';
import { ChangePasswordDialog } from './dialogs/ChangePasswordDialog';
import { EditProfileDialog } from './dialogs/EditProfileDialog';
import { useRouter } from 'next/navigation';

import { useEffect, useState } from 'react';

import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Book, User, UserRound, LogOut, LockKeyhole, UserPen, ChevronUp } from 'lucide-react';
import { EditUserDialog } from './dialogs/EditUserDialog';

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

function getCoursesForUser(
  user: {
    id: string;
    role: 'ADMIN' | 'FACULTY' | 'TA' | 'STUDENT';
  },
  courses: Course[],
) {
  switch (user.role) {
    case 'ADMIN':
      // Admin sees all published courses
      return courses.filter((c) => c.isPublished);

    case 'FACULTY':
      // Faculty sees all their courses (published & unpublished)
      return courses.filter((c) => c.faculty.some((f) => f.id === user.id));

    case 'TA':
      // TA sees all their courses (published & unpublished)
      return courses.filter((c) => c.tas.some((t) => t.id === user.id));

    case 'STUDENT':
      // Students see only published courses they are enrolled in
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
  const router = useRouter();
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  useEffect(() => {
    const fetchCourses = async () => {
      try {
        const res = await fetch('/api/courses');
        if (!res.ok) throw new Error('Failed to fetch courses');
        const data = await res.json();
        setCourses(data);
      } catch (err) {
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
  } = session.user as any;

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

  // Fetch courses for user
  const filteredCourses = getCoursesForUser(user, courses);

  return (
    <>
      <SidebarContent>
        {(user.role === 'ADMIN' || user.role === 'FACULTY') && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground text-sm">
              Admin Menu
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminMenu.map(({ title, url, icon: Icon }) => (
                  <SidebarMenuItem key={url}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === url}
                      className={cn(
                        'hover:bg-secondary focus:bg-secondary text-sidebar-foreground',
                        'data-[active=true]:bg-secondary',
                      )}
                    >
                      <Link href={url}>
                        <Icon className="h-4 w-4" />
                        {title}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
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
              {filteredCourses.map((course) => (
                <SidebarMenuItem key={course.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(`/dashboard/courses/${course.id}`)}
                    className={cn(
                      'hover:bg-secondary focus:bg-secondary text-sidebar-foreground',
                      'data-[active=true]:bg-secondary',
                    )}
                  >
                    <Link href={`/dashboard/courses/${course.id}`}>
                      <Book className="h-4 w-4" />
                      <span>{course.code}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
                    onClick={() => setEditProfileOpen(true)}
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
