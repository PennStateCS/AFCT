import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() => vi.fn());
const cookiesMock = vi.hoisted(() => vi.fn());
const redirectError = vi.hoisted(() => new Error('NEXT_REDIRECT'));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('next/headers', () => ({ cookies: cookiesMock }));
vi.mock('@/components/DashboardSidebarShell', () => ({
  __esModule: true,
  default: () => <div data-testid="sidebar-shell" />,
}));
vi.mock('@/components/Navbar', () => ({
  __esModule: true,
  default: () => <div data-testid="navbar" />,
}));
vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/AuthGate', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/navbar/NavbarBreadcrumbContext', () => ({
  NavbarBreadcrumbProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import DashboardLayout from './layout';

beforeEach(() => {
  vi.clearAllMocks();
  redirectMock.mockImplementation(() => {
    throw redirectError;
  });
  cookiesMock.mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
  });
});

describe('DashboardLayout', () => {
  it('redirects unauthenticated users to login', async () => {
    authMock.mockResolvedValue(null);

    await expect(DashboardLayout({ children: <div>Child</div> })).rejects.toThrow(redirectError);

    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('redirects temp-password users to change-password', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', mustChangePassword: true } });

    await expect(DashboardLayout({ children: <div>Child</div> })).rejects.toThrow(redirectError);

    expect(redirectMock).toHaveBeenCalledWith('/change-password');
  });

  it('renders dashboard shell for standard sessions', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', mustChangePassword: false } });
    redirectMock.mockReset();

    const result = await DashboardLayout({ children: <div data-testid="child">Child</div> });
    const element = result as React.ReactElement;

    expect(redirectMock).not.toHaveBeenCalled();
    expect(element).toBeTruthy();
  });
});
