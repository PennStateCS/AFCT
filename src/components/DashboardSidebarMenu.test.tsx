/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const useSessionMock = vi.fn();
const safeSignOutMock = vi.fn();
const usePathnameMock = vi.fn();
const useSidebarMock = vi.fn();

// Render under a fresh QueryClient per test (retry off, no lingering cache) so the
// nav courses query starts clean each time.
const renderWithClient = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

// Set the response the /api/me/courses?view=nav fetch resolves to.
const setNavCourses = (courses: unknown[]) => {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => courses,
  });
};

vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}));

vi.mock('@/lib/safe-signout', () => ({
  safeSignOut: (options: unknown) => safeSignOutMock(options),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock('next/link', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ href, children }: { href: string; children: React.ReactNode }) => (
      <a href={href}>{children}</a>
    ),
  };
});

vi.mock('@/components/ui/sidebar', () => {
  const React = require('react');
  const passthrough =
    (testId: string) =>
    ({ children, ...props }: any) => (
      <div data-testid={testId} {...props}>
        {children}
      </div>
    );
  return {
    SidebarContent: passthrough('sidebar-content'),
    SidebarFooter: passthrough('sidebar-footer'),
    SidebarGroup: passthrough('sidebar-group'),
    SidebarGroupContent: passthrough('sidebar-group-content'),
    SidebarGroupLabel: passthrough('sidebar-group-label'),
    SidebarMenu: passthrough('sidebar-menu'),
    SidebarMenuButton: ({
      children,
      isActive,
      ...props
    }: {
      children: React.ReactNode;
      isActive?: boolean;
    }) => (
      <div data-testid="sidebar-menu-button" data-active={isActive ? 'true' : 'false'} {...props}>
        {children}
      </div>
    ),
    SidebarMenuItem: passthrough('sidebar-menu-item'),
    useSidebar: () => useSidebarMock(),
  };
});

vi.mock('@/components/ui/dropdown-menu', () => {
  const React = require('react');
  const PassThrough = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: PassThrough,
    DropdownMenuTrigger: PassThrough,
    DropdownMenuContent: PassThrough,
    // Forward props (onClick now lives on the item, not an inner button).
    DropdownMenuItem: ({ children, ...props }: { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    DropdownMenuLabel: ({ children, ...props }: { children: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    DropdownMenuSeparator: () => <hr />,
  };
});

vi.mock('@/components/ui/tooltip', () => {
  const React = require('react');
  const PassThrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    TooltipProvider: PassThrough,
    TooltipTrigger: PassThrough,
    TooltipContent: PassThrough,
    Tooltip: PassThrough,
  };
});

const ChangePasswordDialogMock = vi.fn((_props: unknown) => (
  <div data-testid="change-password-dialog" />
));
const EditProfileDialogMock = vi.fn((_props: unknown) => <div data-testid="edit-profile-dialog" />);

vi.mock('./dialogs/ChangePasswordDialog', () => ({
  ChangePasswordDialog: (props: unknown) => ChangePasswordDialogMock(props),
}));

vi.mock('./dialogs/EditProfileDialog', () => ({
  EditProfileDialog: (props: unknown) => EditProfileDialogMock(props),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import DashboardSidebarMenu from './DashboardSidebarMenu';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  useSidebarMock.mockReturnValue({ state: 'expanded' });
  usePathnameMock.mockReturnValue('/dashboard');
  useSessionMock.mockReturnValue({
    data: { user: { id: 'user-1', email: 'user@example.com', role: 'ADMIN', isAdmin: true } },
  });
  setNavCourses([]);
});

describe('DashboardSidebarMenu', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders admin navigation links for privileged users', () => {
    renderWithClient(<DashboardSidebarMenu />);

    expect(screen.getByText('Admin Menu')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'User Accounts' })).toHaveAttribute(
      'href',
      '/dashboard/users',
    );
    expect(screen.getByRole('link', { name: 'System Status' })).toHaveAttribute(
      'href',
      '/dashboard/system-status',
    );
    expect(screen.getByRole('link', { name: 'System Settings' })).toHaveAttribute(
      'href',
      '/dashboard/system-settings',
    );
    expect(screen.getByRole('link', { name: 'Development Tests' })).toHaveAttribute(
      'href',
      '/dashboard/development-tests',
    );
  });

  it('hides Development Tests link in production mode', () => {
    vi.stubEnv('NODE_ENV', 'production');

    renderWithClient(<DashboardSidebarMenu />);

    expect(screen.queryByRole('link', { name: 'Development Tests' })).toBeNull();
  });

  it('buckets non-archived courses into Upcoming/Current/Past sections, sorted by code', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: 'student-1', email: 'stud@example.com', isAdmin: false } },
    });
    setNavCourses([
      // current (now within range) — two of them, out of code order to test sorting
      {
        id: 'cur2',
        code: 'CS102',
        isPublished: true,
        isArchived: false,
        startDate: '2000-01-01',
        endDate: '2999-12-31',
      },
      {
        id: 'cur1',
        code: 'CS101',
        isPublished: true,
        isArchived: false,
        startDate: '2000-01-01',
        endDate: '2999-12-31',
      },
      // upcoming (starts in the future)
      {
        id: 'up',
        code: 'CS900',
        isPublished: true,
        isArchived: false,
        startDate: '2999-01-01',
        endDate: '2999-12-31',
      },
      // past (already ended)
      {
        id: 'past',
        code: 'CS001',
        isPublished: true,
        isArchived: false,
        startDate: '2000-01-01',
        endDate: '2000-12-31',
      },
    ]);
    renderWithClient(<DashboardSidebarMenu />);

    await waitFor(() => {
      expect(screen.getByText('Upcoming Courses')).toBeInTheDocument();
    });
    expect(screen.getByText('Current Courses')).toBeInTheDocument();
    expect(screen.getByText('Past Courses')).toBeInTheDocument();

    const courseLinks = screen
      .getAllByRole('link')
      .map((l) => l.textContent)
      .filter((t) => t?.startsWith('CS'));
    // Section order upcoming → current → past, alphabetized within Current.
    expect(courseLinks).toEqual(['CS900', 'CS101', 'CS102', 'CS001']);
  });

  it('omits sections that have no courses', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: 'student-1', email: 'stud@example.com', isAdmin: false } },
    });
    setNavCourses([
      {
        id: 'up',
        code: 'CS900',
        isPublished: true,
        isArchived: false,
        startDate: '2999-01-01',
        endDate: '2999-12-31',
      },
    ]);
    renderWithClient(<DashboardSidebarMenu />);

    await waitFor(() => {
      expect(screen.getByText('Upcoming Courses')).toBeInTheDocument();
    });
    expect(screen.queryByText('Current Courses')).toBeNull();
    expect(screen.queryByText('Past Courses')).toBeNull();
  });

  it('links Archived Courses to the archived page when a non-admin is in an archived course', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: 'student-1', email: 'stud@example.com', isAdmin: false } },
    });
    setNavCourses([{ id: 'course-1', code: 'CS101', isPublished: true, isArchived: true }]);
    renderWithClient(<DashboardSidebarMenu />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Archived Courses' })).toHaveAttribute(
        'href',
        '/dashboard/archived-courses',
      );
    });
  });

  it('hides the Archived Courses link for a non-admin with no archived courses', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: 'student-1', email: 'stud@example.com', isAdmin: false } },
    });
    setNavCourses([{ id: 'course-1', code: 'CS101', isPublished: true, isArchived: false }]);
    renderWithClient(<DashboardSidebarMenu />);

    // Wait for the nav query to resolve, then confirm the link never appears.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/me/courses?view=nav');
    });
    expect(screen.queryByRole('link', { name: 'Archived Courses' })).toBeNull();
  });

  it('always shows the Archived Courses link for admins, even with none', async () => {
    // Default session is an admin; no archived courses in the nav list.
    renderWithClient(<DashboardSidebarMenu />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/me/courses?view=nav');
    });
    expect(screen.getByRole('link', { name: 'Archived Courses' })).toHaveAttribute(
      'href',
      '/dashboard/archived-courses',
    );
  });

  it('renders a placeholder message when no courses are visible', () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: 'fac-1', email: 'fac@example.com', role: 'FACULTY' } },
    });
    setNavCourses([]);

    renderWithClient(<DashboardSidebarMenu />);

    expect(screen.getByText('No courses')).toBeInTheDocument();
  });

  it('hides the admin menu for non-admin users', () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: 'student-1', email: 'stud@example.com', isAdmin: false } },
    });

    renderWithClient(<DashboardSidebarMenu />);

    expect(screen.queryByText('Admin Menu')).toBeNull();
  });

  it('does not list archived courses', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: 'user-1', email: 'user@example.com', role: 'FACULTY' } },
    });
    setNavCourses([{ id: 'course-1', code: 'CS101', isPublished: true, isArchived: true }]);

    renderWithClient(<DashboardSidebarMenu />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/me/courses?view=nav');
    });
    expect(screen.queryByRole('link', { name: 'CS101' })).toBeNull();
  });

  it('calls safeSignOut when the user selects Sign out', () => {
    renderWithClient(<DashboardSidebarMenu />);

    fireEvent.click(screen.getByText('Sign out'));

    expect(safeSignOutMock).toHaveBeenCalledWith({ callbackUrl: '/' });
  });

  it('renders nothing when the session is missing user data', () => {
    useSessionMock.mockReturnValue({ data: null });

    const { container } = renderWithClient(<DashboardSidebarMenu />);

    expect(container).toBeEmptyDOMElement();
  });
});
