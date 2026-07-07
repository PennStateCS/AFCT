/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

const useSessionMock = vi.fn();
const safeSignOutMock = vi.fn();
const usePathnameMock = vi.fn();
const useSidebarMock = vi.fn();
const useSWRMock = vi.fn();

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

vi.mock('swr', () => ({
  __esModule: true,
  // useSWRMock is a test mock, not a React hook — the rules-of-hooks match here is a false positive.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  default: (key: string, fetcher: unknown, options: unknown) => useSWRMock(key, fetcher, options),
}));

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
    DropdownMenuItem: PassThrough,
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
  useSidebarMock.mockReturnValue({ state: 'expanded' });
  usePathnameMock.mockReturnValue('/dashboard');
  useSessionMock.mockReturnValue({
    data: { user: { id: 'user-1', email: 'user@example.com', role: 'ADMIN', isAdmin: true } },
  });
  useSWRMock.mockReturnValue({ data: [] });
});

describe('DashboardSidebarMenu', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders admin navigation links for privileged users', () => {
    render(<DashboardSidebarMenu />);

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

    render(<DashboardSidebarMenu />);

    expect(screen.queryByRole('link', { name: 'Development Tests' })).toBeNull();
  });

  it('shows only published courses to students', () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: 'student-1', email: 'stud@example.com', role: 'STUDENT' } },
    });
    useSWRMock.mockReturnValue({
      data: [
        { id: 'course-1', code: 'CS101', isPublished: true, isArchived: false },
        { id: 'course-2', code: 'CS102', isPublished: false, isArchived: false },
      ],
    });
    render(<DashboardSidebarMenu />);

    expect(screen.getByRole('link', { name: 'CS101' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'CS102' })).toBeNull();
  });

  it('renders a placeholder message when no courses are visible', () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: 'fac-1', email: 'fac@example.com', role: 'FACULTY' } },
    });
    useSWRMock.mockReturnValue({ data: [] });

    render(<DashboardSidebarMenu />);

    expect(screen.getByText('No courses')).toBeInTheDocument();
  });

  it('hides the admin menu for students', () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: 'student-1', email: 'stud@example.com', role: 'STUDENT' } },
    });

    render(<DashboardSidebarMenu />);

    expect(screen.queryByText('Admin Menu')).toBeNull();
  });

  it('does not list archived courses', () => {
    useSessionMock.mockReturnValue({
      data: { user: { id: 'user-1', email: 'user@example.com', role: 'FACULTY' } },
    });
    useSWRMock.mockReturnValue({
      data: [{ id: 'course-1', code: 'CS101', isPublished: true, isArchived: true }],
    });

    render(<DashboardSidebarMenu />);

    expect(screen.queryByRole('link', { name: 'CS101' })).toBeNull();
  });

  it('calls safeSignOut when the user selects Sign out', () => {
    render(<DashboardSidebarMenu />);

    fireEvent.click(screen.getByText('Sign out'));

    expect(safeSignOutMock).toHaveBeenCalledWith({ callbackUrl: '/' });
  });

  it('renders nothing when the session is missing user data', () => {
    useSessionMock.mockReturnValue({ data: null });

    const { container } = render(<DashboardSidebarMenu />);

    expect(container).toBeEmptyDOMElement();
  });
});
