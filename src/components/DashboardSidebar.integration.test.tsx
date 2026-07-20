/** @vitest-environment jsdom */

/**
 * Integration coverage for the dashboard sidebar using the REAL sidebar primitives.
 *
 * The unit tests next door replace SidebarProvider, links, buttons and tooltips with
 * plain <div>s, which is fine for checking which items render but structurally cannot
 * catch the things that actually broke: mobile open/closed state, the drawer staying
 * open after navigation, landmark roles, and aria-current. Those need the real
 * components, so this file mocks only the environment (session, route, viewport, fetch).
 */

import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const useSessionMock = vi.fn();
const usePathnameMock = vi.fn();
const isMobileMock = vi.fn();

vi.mock('next-auth/react', () => ({ useSession: () => useSessionMock() }));
vi.mock('next/navigation', () => ({ usePathname: () => usePathnameMock() }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => isMobileMock() }));
vi.mock('@/lib/safe-signout', () => ({ safeSignOut: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The account dialogs pull in heavy form deps and are not what this file exercises.
vi.mock('./dialogs/ChangePasswordDialog', () => ({ ChangePasswordDialog: () => null }));
vi.mock('./dialogs/EditProfileDialog', () => ({ EditProfileDialog: () => null }));

import { SidebarProvider, Sidebar } from '@/components/ui/sidebar';
import { EnhancedSidebarTrigger } from '@/components/ui/EnhancedSidebarTrigger';
import DashboardSidebarHeader from './DashboardSidebarHeader';
import DashboardSidebarMenu from './DashboardSidebarMenu';

beforeAll(() => {
  // Radix (Sheet/Tooltip/Dropdown) needs these in jsdom.
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= ResizeObserverMock;
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {};
  }
});

const setNavCourses = (courses: unknown[]) => {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => courses,
  });
};

const renderSidebar = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SidebarProvider defaultOpen>
        <EnhancedSidebarTrigger />
        <Sidebar collapsible="icon">
          <DashboardSidebarHeader />
          <DashboardSidebarMenu />
        </Sidebar>
      </SidebarProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
  setNavCourses([]);
  usePathnameMock.mockReturnValue('/dashboard');
  isMobileMock.mockReturnValue(false);
  useSessionMock.mockReturnValue({
    data: { user: { id: 'u1', email: 'prof@example.com', firstName: 'Charles', lastName: 'Xavier' } },
  });
});

describe('dashboard sidebar (real primitives)', () => {
  it('exposes the primary navigation landmark', async () => {
    renderSidebar();
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('marks the current page on the dashboard link', () => {
    usePathnameMock.mockReturnValue('/dashboard');
    renderSidebar();

    expect(screen.getByRole('link', { name: 'AFCT Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('does not mark the dashboard link current on another route', () => {
    usePathnameMock.mockReturnValue('/dashboard/calendar');
    renderSidebar();

    expect(screen.getByRole('link', { name: 'AFCT Dashboard' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
  });

  it('names the account trigger without repeating the user name', () => {
    renderSidebar();

    const trigger = screen.getByRole('button', { name: 'Open account menu for Charles Xavier' });
    expect(trigger).toBeInTheDocument();
  });

  describe('on mobile', () => {
    beforeEach(() => isMobileMock.mockReturnValue(true));

    // While the drawer is open Radix marks the rest of the document aria-hidden, so the
    // trigger leaves the accessibility tree; query it with `hidden: true` to inspect the
    // state it is reporting.
    const triggerNode = () =>
      screen.getByRole('button', { name: /sidebar$/i, hidden: true });

    it('reports the mobile drawer state, not the desktop one', async () => {
      const user = userEvent.setup();
      renderSidebar();

      // Closed to start: the trigger must not claim the sidebar is open just because
      // the desktop state defaults to expanded.
      expect(triggerNode()).toHaveAccessibleName('Open sidebar');
      expect(triggerNode()).toHaveAttribute('aria-expanded', 'false');

      await user.click(screen.getByRole('button', { name: 'Open sidebar' }));

      await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
      expect(triggerNode()).toHaveAccessibleName('Close sidebar');
      expect(triggerNode()).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes the drawer when a navigation link is chosen', async () => {
      const user = userEvent.setup();
      renderSidebar();

      await user.click(screen.getByRole('button', { name: 'Open sidebar' }));
      const drawer = await screen.findByRole('dialog');

      // The dashboard layout persists across routes, so the drawer has to close itself.
      fireEvent.click(await within(drawer).findByRole('link', { name: 'Calendar' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(triggerNode()).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('ignores unknown or non-boolean persisted section state', async () => {
    localStorage.setItem(
      'afct.sidebarSections',
      JSON.stringify({ admin: 'yes', bogusSection: true, past: true }),
    );
    useSessionMock.mockReturnValue({
      data: {
        id: 'a1',
        user: { id: 'a1', email: 'admin@example.com', firstName: 'A', lastName: 'D', isAdmin: true },
      },
    });
    renderSidebar();

    // `admin: 'yes'` is not a boolean, so the section falls back to its default (open)
    // rather than being coerced by a truthy string.
    const adminToggle = await screen.findByRole('button', { name: /Administration/ });
    expect(adminToggle).toHaveAttribute('aria-expanded', 'true');
  });
});
