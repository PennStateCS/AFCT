/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { NavbarBreadcrumbProvider } from '@/components/navbar/NavbarBreadcrumbContext';
import CourseBreadcrumbSource from '@/components/navbar/CourseBreadcrumbSource';
import AssignmentBreadcrumbSource from '@/components/navbar/AssignmentBreadcrumbSource';

const setThemeMock = vi.fn();
const useSessionMock = vi.fn();
const usePathnameMock = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: setThemeMock }),
}));

vi.mock('./ui/EnhancedSidebarTrigger', () => ({
  EnhancedSidebarTrigger: () => <div data-testid="sidebar-trigger" />,
}));

vi.mock('@/components/dialogs/ChangePasswordDialog', () => ({
  ChangePasswordDialog: () => <div data-testid="change-password-dialog" />,
}));

vi.mock('@/components/dialogs/EditProfileDialog', () => ({
  EditProfileDialog: () => <div data-testid="edit-profile-dialog" />,
}));

vi.mock('@/components/ui/dropdown-menu', () => {
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({
      children,
      onClick,
    }: {
      children: React.ReactNode;
      onClick?: () => void;
    }) => (
      <button type="button" onClick={onClick}>
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
  it('renders a placeholder nav while the session is loading', () => {
    useSessionMock.mockReturnValue({ status: 'loading' });
    usePathnameMock.mockReturnValue('/');

    const { container } = render(<Navbar />);

    const nav = container.querySelector('nav');
    expect(nav).not.toBeNull();
    expect(nav?.textContent).toBe('');
  });

  it('returns null when no user data is available', () => {
    useSessionMock.mockReturnValue({ status: 'authenticated', data: { user: null } });
    usePathnameMock.mockReturnValue('/');

    const { container } = render(<Navbar />);

    expect(container.firstChild).toBeNull();
  });

  it('shows the Admin badge for admins and breadcrumb labels from provider sources', () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          name: 'Ada Lovelace',
          isAdmin: true,
        },
      },
    });
    usePathnameMock.mockReturnValue('/dashboard/courses/course-123/assignment-456');

    renderNavbar({
      course: { id: 'course-123', name: 'Course Alpha' },
      assignment: { id: 'assignment-456', title: 'Assignment Beta' },
    });

    expect(screen.getByText('Course Alpha')).toBeInTheDocument();
    expect(screen.getByText('Assignment Beta')).toBeInTheDocument();
    // The name and profile picture are no longer shown; only the Admin badge.
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
    expect(screen.queryByLabelText('User avatar')).toBeNull();
    expect(screen.getByText('Admin')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Dark'));
    expect(setThemeMock).toHaveBeenCalledWith('dark');
  });

  it('does not show an Admin badge for non-admin users', () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          name: 'Ada Lovelace',
          isAdmin: false,
        },
      },
    });
    usePathnameMock.mockReturnValue('/dashboard/system-settings');

    renderNavbar();

    expect(screen.queryByText('Admin')).toBeNull();
    expect(screen.getByText('System Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('Breadcrumb')).toBeInTheDocument();
  });

  it('builds stable course and assignment breadcrumbs from route patterns', () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          firstName: 'Peter',
          lastName: 'Parker',
          name: 'Peter Parker',
          role: 'STUDENT',
          avatar: 'peter.png',
        },
      },
    });
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
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          firstName: 'Bruce',
          lastName: 'Wayne',
          isAdmin: false,
        },
      },
    });
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
