'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Badge } from '@/components/ui/RoleBadge';

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
  const segments = pathname.split('/').filter(Boolean);

  const [courseName, setCourseName] = useState<string | null>(null);
  const [assignmentName, setAssignmentName] = useState<string | null>(null);

  // Fetch course and assignment names for breadcrumbs
  useEffect(() => {
    // If on a course page (or assignment page), fetch course name
    if (segments[1] === 'courses' && segments[2]) {
      const courseId = segments[2];
      fetch(`/api/courses/${courseId}`)
        .then((res) => res.json())
        .then((data) => setCourseName(data.name))
        .catch(() => setCourseName(null));
    } else {
      setCourseName(null);
    }

    // If on an assignment page, fetch assignment name
    if (segments[1] === 'courses' && segments[2] && segments[3]) {
      const courseId = segments[2];
      const assignmentId = segments[3];
      fetch(`/api/courses/${courseId}/${assignmentId}`)
        .then((res) => res.json())
        .then((data) => setAssignmentName(data.title || data.name))
        .catch(() => setAssignmentName(null));
    } else {
      setAssignmentName(null);
    }
  }, [segments]);

  if (status === 'loading') {
    return (
      <nav className="bg-secondary mb-4 flex h-16 items-center justify-between rounded-lg border p-4 text-white shadow-sm" />
    );
  }

  if (!data?.user) return null;

  const { firstName, lastName, role, avatar } = data.user;
  const roleDisplay = role || 'STUDENT';
  const avatarUrl = avatar ? `/uploads/pfps/${avatar}` : '/uploads/pfps/default-avatar.png';
  
  // Use session.user.name first (which is built from firstName + lastName in auth)
  // Then fallback to building it from individual fields, then fallback to 'User'
  const fullName = data.user.name || 
    [firstName, lastName].filter(Boolean).join(' ') || 
    'User';

  return (
    <nav className="bg-secondary bordery mb-4 flex h-16 items-center justify-between rounded-lg p-4 text-white shadow-sm">
      <div className="flex items-center gap-4">
        <EnhancedSidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList className="text-sm">
            {segments.map((segment, index) => {
              const isLast = index === segments.length - 1;
              const href = '/' + segments.slice(0, index + 1).join('/');

              let label = segment.charAt(0).toUpperCase() + segment.slice(1);

              // Show course name instead of id
              if (segments[1] === 'courses' && index === 2 && courseName) {
                label = courseName;
              }
              // Show assignment name instead of aid
              if (segments[1] === 'courses' && index === 3 && assignmentName) {
                label = assignmentName;
              }

              return (
                <React.Fragment key={href}>
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage className="text-white">{label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        href={href}
                        className="text-secondary-foreground hover:text-secondary-foreground hover:underline"
                      >
                        {label}
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
              className="hover:text-red hover:bg-background bg-card border text-black"
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
