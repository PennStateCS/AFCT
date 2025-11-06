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

  const [courseId, setCourseId] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);

  const [courseName, setCourseName] = useState<string | null>(null);
  const [assignmentName, setAssignmentName] = useState<string | null>(null);

  // Fetch course and assignment names for breadcrumbs
  useEffect(() => {
    // Function to fetch data
    const fetchData = async (url: string) => {
      try {
        const dataReq = await fetch(url);
        if (dataReq.ok) {
          const instData = await dataReq.json();
          return instData;
        }
      } catch (err) {
        console.log("Error fetching navbar: ", err)
        setCourseName(null);
        setAssignmentName(null);
      }
    }

    const loadNames = async () => {
      // Reset course and assignment
      setCourseId(null);
      setAssignmentId(null);
      setCourseName(null);
      setAssignmentName(null);
      
      // Set base url for an easy call
      const baseUrl = '/api';
    
      // If on a course page (or assignment page), fetch course name, and assignment name appropriately
      if (segments[1] === 'courses' && segments[2]) {
        const cid = segments[2];
        setCourseId(cid);

        const courseJson = (await fetchData(`${baseUrl}/courses/${cid}`)); // Returns JSON data of course from API call
        setCourseName(courseJson.name);

        // Assignment in a course
        if (segments[3]) {
          const aid = segments[3];
          setAssignmentId(aid);

          const assignmentJson = (await fetchData(`${baseUrl}/courses/${cid}/${aid}`)); // Returns JSON data of assignment from API call
          setAssignmentName(assignmentJson.title);
        }
      } 

      // If a student is on an assignment page, fetch assignment name
      else if (segments[1] === `assignments` && segments[2]) {
        const aid = segments[2];
        // Set assignment id
        setAssignmentId(aid);

        // Get JSON of both assignment and course
        const assignmentJson = (await fetchData(`${baseUrl}/assignments/${aid}`)); // Returns JSON data of assignment from API call
        const courseJson = (await fetchData(`${baseUrl}/courses/${assignmentJson.courseId}`)); // Returns JSON data of course from API call

        // Set the course id
        setCourseId(assignmentJson.courseId);

        // Set both the assignment title and the course name
        setAssignmentName(assignmentJson.title);
        setCourseName(courseJson.name);
      }
    };

    loadNames();
  }, [segments.join('/')]);

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

  // Generate a displSegments variable that is used to display the segments. Changes non-existent paths to proper ones.
  const displSegments = segments.map((segment, index) => {
    // Show assignment name instead of aid (student view)
    if (segments[1] === 'assignments' && index === 1 && courseId) { return courseId; }

    // Else return the segment
    return segment;
  });

  return (
    <nav className="bg-secondary bordery mb-4 flex h-16 items-center justify-between rounded-lg p-4 text-white shadow-sm">
      <div className="flex items-center gap-4">
        <EnhancedSidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList className="text-sm">
            {displSegments.map((segment, index) => {
              // Code segment iterates through the map for each index
              const isLast = index === displSegments.length - 1;

              let href = '/' + displSegments.slice(0, index + 1).join('/');
              let label = (segment ? segment : "ERROR").charAt(0).toUpperCase() + (segment ? segment : "ERROR").slice(1);

              // Show course name instead of id
              if (segments[1] === 'courses' && index === 2 && courseName) { label = courseName; }

              // Show assignment name instead of aid (teacher view)
              else if (segments[1] === 'courses' && index === 3 && assignmentName) { label = assignmentName; }
              
              // Show course name instead of assignments (student view)
              else if (segments[1] === 'assignments' && index === 1 && courseName) {
                label = courseName;
                href = `${href.split('/').splice(0, 2).join('/')}/courses/${courseId}`;
              }

              // Show assignment name instead of aid (student view)
              else if (segments[1] === 'assignments' && index === 2 && assignmentName) { label = assignmentName; }

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
