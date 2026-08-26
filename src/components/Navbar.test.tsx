/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NavbarBreadcrumbProvider } from '@/components/navbar/NavbarBreadcrumbContext';
import CourseBreadcrumbSource from '@/components/navbar/CourseBreadcrumbSource';
import AssignmentBreadcrumbSource from '@/components/navbar/AssignmentBreadcrumbSource';

const setThemeMock = vi.fn();
const usePathnameMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: setThemeMock }),
}));

vi.mock('./ui/EnhancedSidebarTrigger', () => ({
  EnhancedSidebarTrigger: () => <div data-testid="sidebar-trigger" />,
}));

vi.mock('@/components/ui/dropdown-menu', () => {
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    // Theme picker: forward the group's onValueChange to each item so a click
    // reports the chosen value, mirroring Radix's radio-group wiring.
    DropdownMenuRadioGroup: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange?: (value: string) => void;
    }) => (
      <div>
        {React.Children.map(children, (child) =>
          React.isValidElement(child)
            ? React.cloneElement(
                child as React.ReactElement<{ onValueChange?: (v: string) => void }>,
                { onValueChange },
              )
            : child,
        )}
      </div>
    ),
    DropdownMenuRadioItem: ({
      children,
      value,
      onValueChange,
    }: {
      children: React.ReactNode;
      value: string;
      onValueChange?: (value: string) => void;
    }) => (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    ),
  };
});

import Navbar from './Navbar';

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  vi.restoreAllMocks();
});

function renderNavbar(withLabels?: {
  course?: { id: string; name: string };
  assignment?: { id: string; title: string };
}) {
  return render(
    <NavbarBreadcrumbProvider>
      {withLabels?.course ? (
        <CourseBreadcrumbSource
          courseId={withLabels.course.id}
          courseName={withLabels.course.name}
        />
      ) : null}
      {withLabels?.assignment ? (
        <AssignmentBreadcrumbSource
          assignmentId={withLabels.assignment.id}
          assignmentTitle={withLabels.assignment.title}
        />
      ) : null}
      <Navbar />
    </NavbarBreadcrumbProvider>,
  );
}

describe('Navbar', () => {
  it('renders breadcrumb labels from provider sources', () => {
    usePathnameMock.mockReturnValue('/dashboard/courses/course-123/assignment-456');

    renderNavbar({
      course: { id: 'course-123', name: 'Course Alpha' },
      assignment: { id: 'assignment-456', title: 'Assignment Beta' },
    });

    expect(screen.getByText('Course Alpha')).toBeInTheDocument();
    expect(screen.getByText('Assignment Beta')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Dark'));
    expect(setThemeMock).toHaveBeenCalledWith('dark');
  });

  it('carries no account menu: the sidebar footer owns those actions', () => {
    usePathnameMock.mockReturnValue('/dashboard/system-settings');

    renderNavbar();

    // Positive first, so this cannot pass by rendering nothing at all: the only buttons
    // the navbar has left are the theme trigger and its four options (the sidebar trigger
    // is mocked as a div). Re-adding an account trigger would land in this list and fail.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Toggle theme',
      'Light',
      'Dark',
      'System',
      'High contrast',
    ]);
    expect(screen.getByLabelText('Breadcrumb')).toBeInTheDocument();
    expect(screen.getByText('System Settings')).toBeInTheDocument();

    expect(screen.queryByText('Sign out')).toBeNull();
    expect(screen.queryByText('User Account')).toBeNull();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('builds stable course and assignment breadcrumbs from route patterns', () => {
    usePathnameMock.mockReturnValue('/dashboard/courses/course-99/assignment-42');

    renderNavbar({
      course: { id: 'course-99', name: 'Web Systems' },
      assignment: { id: 'assignment-42', title: 'Homework 1' },
    });

    const courseCrumb = screen.getByRole('link', { name: 'Web Systems' });
    expect(courseCrumb).toHaveAttribute('href', '/dashboard/courses/course-99');
    expect(screen.getByText('Homework 1')).toBeInTheDocument();
  });

  // The bug this replaced: the trail was capped at 50/60vw and each label at 8/14/22rem,
  // so a long title truncated on a wide screen with hundreds of spare pixels. jsdom does no
  // layout, so what these can prove is that the caps are gone and the flex sizing that
  // replaced them is present. Whether text actually fits is a browser question.
  const LONG_COURSE = 'Introduction to Computer Programming and Problem Solving';
  const LONG_ASSIGNMENT = 'Programming Assignment 6: Object-Oriented Design and File Processing';

  const renderLongTrail = () => {
    usePathnameMock.mockReturnValue('/dashboard/courses/course-1/assignment-1');
    renderNavbar({
      course: { id: 'course-1', name: LONG_COURSE },
      assignment: { id: 'assignment-1', title: LONG_ASSIGNMENT },
    });
  };

  it('carries no hardcoded width caps on the trail or its labels', () => {
    renderLongTrail();
    const nav = screen.getByLabelText('Breadcrumb');
    const html = nav.outerHTML;
    for (const cap of [
      'max-w-[50vw]',
      'max-w-[60vw]',
      'max-w-[8rem]',
      'max-w-[14rem]',
      'max-w-[22rem]',
    ]) {
      expect(html).not.toContain(cap);
    }
    // No replacement cap either: moving 22rem to 40rem would only move the bug.
    expect(html).not.toMatch(/max-w-\[\d/);
  });

  it('gives the trail the leftover header width rather than a share of the viewport', () => {
    renderLongTrail();
    const nav = screen.getByLabelText('Breadcrumb');
    expect(nav.className).toContain('min-w-0');
    expect(nav.className).toContain('flex-1');
    const list = nav.querySelector('[data-slot="breadcrumb-list"]') as HTMLElement;
    expect(list.className).toContain('flex-nowrap');
    expect(list.className).toContain('min-w-0');
  });

  it('keeps the full label in the DOM and as the accessible name when it truncates', () => {
    renderLongTrail();
    // Truncation is visual only: the text is never shortened, so a screen reader still
    // hears the whole thing, and title= surfaces it on hover.
    const page = screen.getByText(LONG_ASSIGNMENT);
    expect(page).toHaveAttribute('aria-current', 'page');
    expect(page).toHaveAttribute('title', LONG_ASSIGNMENT);
    const courseLink = screen.getByRole('link', { name: LONG_COURSE });
    expect(courseLink).toHaveAttribute('title', LONG_COURSE);
    expect(courseLink).toHaveAttribute('href', '/dashboard/courses/course-1');
  });

  it('gives the current page priority over a long ancestor', () => {
    renderLongTrail();
    const page = screen.getByText(LONG_ASSIGNMENT).closest('li') as HTMLElement;
    const course = screen.getByRole('link', { name: LONG_COURSE }).closest('li') as HTMLElement;
    // The current page grows into spare width; a long ancestor may only give it up.
    expect(page.className).toContain('flex-1');
    expect(course.className).toContain('shrink');
    expect(course.className).not.toContain('shrink-0');
    // A short, known ancestor holds its size instead of truncating.
    const courses = screen.getByRole('link', { name: 'Courses' }).closest('li') as HTMLElement;
    expect(courses.className).toContain('shrink-0');
  });

  it('reveals levels progressively, and never leaves an orphan separator', () => {
    renderLongTrail();
    const nav = screen.getByLabelText('Breadcrumb');
    const items = Array.from(nav.querySelectorAll('li'));
    // Dashboard > Courses > course > assignment, with a separator before each but the first.
    const separators = items.filter(
      (el) => el.getAttribute('data-slot') === 'breadcrumb-separator',
    );
    const crumbs = items.filter((el) => el.getAttribute('data-slot') === 'breadcrumb-item');
    expect(crumbs).toHaveLength(4);
    expect(separators).toHaveLength(3);

    // The current page is the only thing a phone shows, so it is never hidden.
    expect(crumbs[3].className).not.toContain('hidden');
    // Dashboard arrives at sm, the middle levels at lg.
    expect(crumbs[0].className).toContain('hidden sm:inline-flex');
    expect(crumbs[1].className).toContain('hidden lg:inline-flex');
    expect(crumbs[2].className).toContain('hidden lg:inline-flex');

    // Every separator appears no earlier than the crumb it introduces, which is what stops
    // "> Real Life Examples" or "Dashboard > > Real Life Examples".
    expect(separators[0].className).toContain('hidden lg:inline-flex');
    expect(separators[1].className).toContain('hidden lg:inline-flex');
    expect(separators[2].className).toContain('hidden sm:inline-flex');
    separators.forEach((el) => expect(el.className).toContain('shrink-0'));
  });

  it('keeps the fixed controls fixed', () => {
    renderLongTrail();
    // A long trail must never push the theme control off screen.
    const themeTrigger = screen.getByRole('button', { name: 'Toggle theme' });
    const group = themeTrigger.closest('div.shrink-0');
    expect(group).not.toBeNull();
  });

  it('supports all theme actions', () => {
    usePathnameMock.mockReturnValue('/dashboard/users');

    renderNavbar();

    fireEvent.click(screen.getByText('Light'));
    fireEvent.click(screen.getByText('Dark'));
    fireEvent.click(screen.getByText('System'));
    fireEvent.click(screen.getByText('High contrast'));

    expect(setThemeMock).toHaveBeenCalledWith('light');
    expect(setThemeMock).toHaveBeenCalledWith('dark');
    expect(setThemeMock).toHaveBeenCalledWith('system');
    // The value has to be the class name the .high-contrast block uses, hyphen included.
    expect(setThemeMock).toHaveBeenCalledWith('high-contrast');
  });
});
