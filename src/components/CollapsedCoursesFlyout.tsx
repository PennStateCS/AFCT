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
};

export type FlyoutSection = {
  /** Matches the sidebar's own bucket ids: upcoming | current | past. */
  bucket: string;
  /** Heading for this group inside the flyout. */
  label: string;
  courses: FlyoutCourse[];
};

const linkStyles =
  'focus-visible:ring-sidebar-ring hover:bg-sidebar-accent block rounded-md border-l-2 border-transparent px-2 py-1.5 focus-visible:ring-2 focus-visible:outline-none';

/** One course, listed by its code exactly as the expanded sidebar lists it. */
function CourseLink({
  href,
  code,
  active,
  onNavigate,
}: {
  href: string;
  code: string;
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
          'text-sm',
          // The active course is marked three ways, since colour alone would leave it
          // indistinguishable to anyone who cannot see the highlight: a left bar, a
          // heavier code, and aria-current for screen readers.
          active &&
            'border-sidebar-foreground bg-sidebar-primary text-sidebar-primary-foreground font-semibold',
        )}
      >
        <span className="block truncate">{code}</span>
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
  isSectionOpen,
  onToggleSection,
}: {
  sections: FlyoutSection[];
  /** Course whose page is being viewed, or null. */
  activeCourseId: string | null;
  pathname: string;
  /** The sidebar's own open/closed state for a bucket, so both views agree. */
  isSectionOpen: (bucket: string) => boolean;
  onToggleSection: (bucket: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();

  // Any navigation the flyout did not start (a link elsewhere on the page, the back
  // button) leaves it hanging over a page it no longer describes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // The rail shows no course icons any more, so the button itself has to say that the
  // page being viewed is one of them.
  const anyCourseActive = activeCourseId !== null;

  const renderCourses = (courses: FlyoutCourse[]) =>
    courses.map((course) => (
      <CourseLink
        key={course.id}
        href={`/dashboard/courses/${course.id}`}
        code={course.code}
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
                  className="text-sidebar-foreground focus-visible:bg-sidebar-accent data-[state=open]:bg-sidebar-primary data-[state=open]:text-sidebar-primary-foreground justify-center"
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
              className="text-sidebar-foreground px-5 text-sm shadow [--tooltip-surface:var(--sidebar)]"
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
          aria-labelledby={headingId}
          className="bg-sidebar text-sidebar-foreground max-h-[70vh] w-64 overflow-y-auto p-2"
        >
          <h2 id={headingId} className="px-2 pt-1 pb-2 text-sm font-semibold">
            Courses
          </h2>

          {/* Every group folds, and each one starts however the expanded sidebar has it,
              since they share the same stored state: open unless the user closed it, with
              Past Courses closed by default. */}
          {sections.map((section) => {
            const listId = `${headingId}-${section.bucket}`;
            const sectionOpen = isSectionOpen(section.bucket);
            return (
              <div key={section.bucket}>
                <h3>
                  <button
                    type="button"
                    onClick={() => onToggleSection(section.bucket)}
                    aria-expanded={sectionOpen}
                    aria-controls={listId}
                    className="text-sidebar-muted-foreground hover:bg-sidebar-accent focus-visible:ring-sidebar-ring flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {section.label}
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        'ml-auto h-3 w-3 shrink-0 transition-transform',
                        sectionOpen ? '' : '-rotate-90',
                      )}
                    />
                  </button>
                </h3>
                {/* Kept mounted and hidden so aria-controls always points at a real
                    element, the same way the expanded sidebar's sections work. */}
                <ul id={listId} hidden={!sectionOpen} className="mt-1 mb-2 space-y-0.5">
                  {renderCourses(section.courses)}
                </ul>
              </div>
            );
          })}
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  );
}
