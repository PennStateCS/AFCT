'use client';

import React, { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { Book, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export type FlyoutCourse = {
  id: string;
  code: string;
  name: string;
};

export type FlyoutSection = {
  /** Matches the sidebar's own bucket ids: upcoming | current | past. */
  bucket: string;
  /** Heading for this group inside the flyout. */
  label: string;
  courses: FlyoutCourse[];
};

const linkStyles =
  'focus-visible:ring-sidebar-ring hover:bg-brand-teal block rounded-md border-l-2 border-transparent px-2 py-1.5 focus-visible:ring-2 focus-visible:outline-none';

/** One course: code on top, full title underneath when the course has one. */
function CourseLink({
  href,
  code,
  name,
  active,
  onNavigate,
}: {
  href: string;
  code: string;
  name?: string;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          linkStyles,
          // The active course is marked three ways, since colour alone would leave it
          // indistinguishable to anyone who cannot see the highlight: a left bar, a
          // heavier code, and aria-current for screen readers.
          active && 'border-sidebar-foreground bg-brand-teal font-semibold text-white',
        )}
      >
        <span className="block truncate text-sm">{code}</span>
        {name ? <span className="block truncate text-xs opacity-80">{name}</span> : null}
      </Link>
    </li>
  );
}

/**
 * The collapsed sidebar's single Courses button and the flyout it opens.
 *
 * In the icon rail every course was the same book icon, so telling two apart meant
 * hovering each one in turn. One button replaces them all and lists the courses, grouped
 * the way the expanded sidebar groups them, in a popover beside the rail.
 *
 * Rendered only while the rail is collapsed, so expanding the sidebar unmounts this and
 * closes the flyout with it. Radix supplies the rest of the dismissal behaviour: outside
 * click, Escape, focus into the panel on open and back to the button on close.
 */
export default function CollapsedCoursesFlyout({
  sections,
  activeCourseId,
  pathname,
  showArchivedCoursesLink,
  pastOpen,
  onTogglePast,
}: {
  sections: FlyoutSection[];
  /** Course whose page is being viewed, or null. */
  activeCourseId: string | null;
  pathname: string;
  showArchivedCoursesLink: boolean;
  /** Past Courses starts collapsed; this is the sidebar's own persisted state for it. */
  pastOpen: boolean;
  onTogglePast: () => void;
}) {
  const [open, setOpen] = useState(false);
  const groupIdPrefix = useId();
  const pastListId = useId();

  // Any navigation the flyout did not start (a link elsewhere on the page, the back
  // button) leaves it hanging over a page it no longer describes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const archivedActive = pathname === '/dashboard/archived-courses';
  // The rail shows no course icons any more, so the button itself has to say that the
  // page being viewed is one of them.
  const anyCourseActive = activeCourseId !== null || archivedActive;

  const renderCourses = (courses: FlyoutCourse[]) =>
    courses.map((course) => (
      <CourseLink
        key={course.id}
        href={`/dashboard/courses/${course.id}`}
        code={course.code}
        name={course.name}
        active={course.id === activeCourseId}
        onNavigate={() => setOpen(false)}
      />
    ));

  return (
    <SidebarMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <SidebarMenuButton
                  aria-label="Courses"
                  isActive={anyCourseActive}
                  className="text-sidebar-foreground hover:bg-brand-teal focus-visible:bg-brand-teal data-[active=true]:bg-brand-teal data-[state=open]:bg-brand-teal justify-center data-[active=true]:text-white data-[state=open]:text-white"
                >
                  {/* The same book each course carried in the rail, so the button reads as those
                      courses gathered into one place. */}
                  <Book className="h-4 w-4 shrink-0" />
                </SidebarMenuButton>
              </PopoverTrigger>
            </TooltipTrigger>
            {/* Hidden while the flyout is open: the panel already names itself, and the
                tooltip would sit on top of it. */}
            <TooltipContent
              side="right"
              hidden={open}
              className="bg-sidebar text-sidebar-foreground px-5 text-sm shadow"
              sideOffset={10}
            >
              Courses
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          // Keeps the panel inside the viewport, and bounded if a user somehow has enough
          // courses to run past it.
          collisionPadding={8}
          // Named rather than titled: the button that opens it already says Courses, so a
          // heading on top would repeat it, but the panel still needs a name to announce.
          aria-label="Courses"
          className="bg-sidebar text-sidebar-foreground max-h-[70vh] w-64 overflow-y-auto p-2"
        >
          {sections.map((section) => {
            const groupHeadingId = `${groupIdPrefix}-${section.bucket}`;
            // Past Courses is the one group that folds, matching the expanded sidebar,
            // where it also starts closed. Upcoming and Current are short enough to show
            // outright.
            if (section.bucket === 'past') {
              return (
                <div key={section.bucket}>
                  <h3>
                    <button
                      type="button"
                      onClick={onTogglePast}
                      aria-expanded={pastOpen}
                      aria-controls={pastListId}
                      className="text-sidebar-foreground/70 hover:bg-brand-teal focus-visible:ring-sidebar-ring flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {section.label}
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          'ml-auto h-3 w-3 shrink-0 transition-transform',
                          pastOpen ? '' : '-rotate-90',
                        )}
                      />
                    </button>
                  </h3>
                  {/* Kept mounted and hidden so aria-controls always points at a real
                      element, the same way the expanded sidebar's sections work. */}
                  <ul id={pastListId} hidden={!pastOpen} className="mt-1 mb-2 space-y-0.5">
                    {renderCourses(section.courses)}
                    {showArchivedCoursesLink && (
                      <li>
                        <Link
                          href="/dashboard/archived-courses"
                          onClick={() => setOpen(false)}
                          aria-current={archivedActive ? 'page' : undefined}
                          className={cn(
                            linkStyles,
                            'text-sm',
                            archivedActive &&
                              'border-sidebar-foreground bg-brand-teal font-semibold text-white',
                          )}
                        >
                          Archived Courses
                        </Link>
                      </li>
                    )}
                  </ul>
                </div>
              );
            }

            return (
              <div key={section.bucket} role="group" aria-labelledby={groupHeadingId}>
                <h3
                  id={groupHeadingId}
                  className="text-sidebar-foreground/70 px-2 py-1 text-xs font-medium"
                >
                  {section.label}
                </h3>
                <ul className="mt-1 mb-2 space-y-0.5">{renderCourses(section.courses)}</ul>
              </div>
            );
          })}
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
