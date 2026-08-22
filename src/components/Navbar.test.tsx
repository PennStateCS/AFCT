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
    // the navbar has left are the theme trigger and its three options (the sidebar trigger
    // is mocked as a div). Re-adding an account trigger would land in this list and fail.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Toggle theme',
      'Light',
      'Dark',
      'System',
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

  it('supports all theme actions', () => {
    usePathnameMock.mockReturnValue('/dashboard/users');

    renderNavbar();

    fireEvent.click(screen.getByText('Light'));
    fireEvent.click(screen.getByText('Dark'));
    fireEvent.click(screen.getByText('System'));

    expect(setThemeMock).toHaveBeenCalledWith('light');
    expect(setThemeMock).toHaveBeenCalledWith('dark');
    expect(setThemeMock).toHaveBeenCalledWith('system');
  });
});
