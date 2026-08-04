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
vi.mock('@/lib/toast', () => import('@/test/mocks/toast').then((m) => m.toastModuleMock));

// The account dialogs pull in heavy form deps and are not what this file exercises.
vi.mock('./dialogs/ChangePasswordDialog', () => ({ ChangePasswordDialog: () => null }));
vi.mock('./dialogs/EditProfileDialog', () => ({ EditProfileDialog: () => null }));

import { SidebarProvider, Sidebar, useSidebar } from '@/components/ui/sidebar';
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

// `open: false` starts the sidebar as the collapsed icon rail, which is where the
// Courses flyout lives.
const renderSidebar = ({ open = true }: { open?: boolean } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <SidebarProvider defaultOpen={open}>
        <EnhancedSidebarTrigger />
        <Sidebar collapsible="icon">
          <DashboardSidebarHeader />
          <DashboardSidebarMenu />
        </Sidebar>
      </SidebarProvider>
    </QueryClientProvider>,
  );
};

// One course per bucket, each with a title so the flyout's second line has something to
// show.
const BUCKETED_COURSES = [
  {
    id: 'up-1',
    code: 'CS900',
    name: 'Quantum Automata',
    isPublished: true,
    isArchived: false,
    startDate: '2999-01-01',
    endDate: '2999-12-31',
  },
  {
    id: 'cur-1',
    code: 'CS101',
    name: 'Computing Theory',
    isPublished: true,
    isArchived: false,
    startDate: '2000-01-01',
    endDate: '2999-12-31',
  },
  {
    id: 'past-1',
    code: 'CS001',
    name: 'Discrete Structures',
    isPublished: true,
    isArchived: false,
    startDate: '2000-01-01',
    endDate: '2000-12-31',
  },
];

const coursesButton = () => screen.getByRole('button', { name: 'Courses' });

/** Open the collapsed rail's Courses flyout and return its panel. */
const openCoursesFlyout = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Courses' }));
  return screen.findByRole('dialog', { name: 'Courses' });
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
  setNavCourses([]);
  usePathnameMock.mockReturnValue('/dashboard');
  isMobileMock.mockReturnValue(false);
  useSessionMock.mockReturnValue({
    data: {
      user: { id: 'u1', email: 'prof@example.com', firstName: 'Charles', lastName: 'Xavier' },
    },
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

  it('starts collapsed to the icon rail on medium-width screens', () => {
    const original = window.innerWidth;
    // Between the mobile drawer breakpoint (768) and the auto-expand width (1024).
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 900 });
    try {
      renderSidebar();
      expect(screen.getByRole('button', { name: /sidebar$/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  it('starts expanded on wide screens', () => {
    // jsdom's default innerWidth (1024) is at the auto-expand width, so the saved
    // preference (defaultOpen) wins and the sidebar renders expanded.
    renderSidebar();
    expect(screen.getByRole('button', { name: /sidebar$/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('does not collapse the desktop state on mobile (the drawer shows full labels)', () => {
    // A regression guard: auto-collapsing to the icon rail on a narrow screen would
    // blank the mobile drawer's labels, since the menu renders icon-only when the
    // state is collapsed. On mobile it must stay expanded.
    isMobileMock.mockReturnValue(true);
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 400 });
    try {
      const StateProbe = () => <span data-testid="sidebar-state">{useSidebar().state}</span>;
      render(
        <SidebarProvider defaultOpen>
          <StateProbe />
        </SidebarProvider>,
      );
      expect(screen.getByTestId('sidebar-state')).toHaveTextContent('expanded');
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  describe('on mobile', () => {
    beforeEach(() => isMobileMock.mockReturnValue(true));

    // While the drawer is open Radix marks the rest of the document aria-hidden, so the
    // trigger leaves the accessibility tree; query it with `hidden: true` to inspect the
    // state it is reporting.
    const triggerNode = () => screen.getByRole('button', { name: /sidebar$/i, hidden: true });

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

  describe('collapsed rail courses flyout', () => {
    beforeEach(() => setNavCourses(BUCKETED_COURSES));

    it('replaces the per-course icons with one Courses button', async () => {
      renderSidebar({ open: false });

      // The rail used to repeat the same book icon per course, which is what this
      // replaces, so no course link may be in the rail before the flyout is opened.
      expect(await screen.findByRole('button', { name: 'Courses' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /CS101/ })).toBeNull();
      expect(coursesButton()).toHaveAttribute('aria-expanded', 'false');
    });

    it('leaves the expanded sidebar listing courses directly', async () => {
      renderSidebar({ open: true });

      expect(await screen.findByRole('link', { name: /CS101/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Courses' })).toBeNull();
    });

    it('keeps the mobile drawer on full labels rather than the flyout', async () => {
      isMobileMock.mockReturnValue(true);
      const user = userEvent.setup();
      renderSidebar({ open: false });

      await user.click(screen.getByRole('button', { name: 'Open sidebar' }));
      const drawer = await screen.findByRole('dialog');

      expect(await within(drawer).findByRole('link', { name: /CS101/ })).toBeInTheDocument();
      expect(within(drawer).queryByRole('button', { name: 'Courses' })).toBeNull();
    });

    it('groups the courses it lists and shows each code with its title', async () => {
      const user = userEvent.setup();
      renderSidebar({ open: false });

      const panel = await openCoursesFlyout(user);
      expect(coursesButton()).toHaveAttribute('aria-expanded', 'true');
      expect(coursesButton()).toHaveAttribute('aria-controls', panel.id);

      expect(within(panel).getByRole('heading', { name: 'Upcoming' })).toBeInTheDocument();
      expect(within(panel).getByRole('heading', { name: 'Current' })).toBeInTheDocument();
      const current = within(panel).getByRole('link', { name: /CS101/ });
      expect(current).toHaveAttribute('href', '/dashboard/courses/cur-1');
      expect(current).toHaveTextContent('Computing Theory');

      // Past Courses folds, and starts closed, as it does in the expanded sidebar.
      const past = within(panel).getByRole('button', { name: /Past Courses/ });
      expect(past).toHaveAttribute('aria-expanded', 'false');
      // Hidden rather than unmounted, so aria-controls keeps pointing at a real element,
      // but out of the accessibility tree until it is opened.
      expect(within(panel).queryByRole('link', { name: /CS001/ })).toBeNull();

      await user.click(past);
      expect(past).toHaveAttribute('aria-expanded', 'true');
      expect(within(panel).getByRole('link', { name: /CS001/ })).toBeVisible();
    });

    it('omits a group with no courses', async () => {
      setNavCourses([BUCKETED_COURSES[1]]);
      const user = userEvent.setup();
      renderSidebar({ open: false });

      const panel = await openCoursesFlyout(user);
      expect(within(panel).getByRole('heading', { name: 'Current' })).toBeInTheDocument();
      expect(within(panel).queryByRole('heading', { name: 'Upcoming' })).toBeNull();
      expect(within(panel).queryByRole('button', { name: /Past Courses/ })).toBeNull();
    });

    it('marks the course being viewed, and the button that now stands for it', async () => {
      usePathnameMock.mockReturnValue('/dashboard/courses/cur-1');
      const user = userEvent.setup();
      renderSidebar({ open: false });

      // The rail no longer shows the course itself, so the button has to carry the fact
      // that a course page is open.
      expect(await screen.findByRole('button', { name: 'Courses' })).toHaveAttribute(
        'data-active',
        'true',
      );

      const panel = await openCoursesFlyout(user);
      expect(within(panel).getByRole('link', { name: /CS101/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(within(panel).getByRole('link', { name: /CS900/ })).not.toHaveAttribute(
        'aria-current',
      );
    });

    it('opens Past Courses when the course being viewed is in it', async () => {
      usePathnameMock.mockReturnValue('/dashboard/courses/past-1');
      const user = userEvent.setup();
      renderSidebar({ open: false });

      const panel = await openCoursesFlyout(user);
      expect(within(panel).getByRole('button', { name: /Past Courses/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(within(panel).getByRole('link', { name: /CS001/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('closes when a course is chosen', async () => {
      const user = userEvent.setup();
      renderSidebar({ open: false });

      const panel = await openCoursesFlyout(user);
      fireEvent.click(within(panel).getByRole('link', { name: /CS101/ }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Courses' })).toBeNull());
    });

    it('closes on Escape and puts focus back on the Courses button', async () => {
      const user = userEvent.setup();
      renderSidebar({ open: false });

      const panel = await openCoursesFlyout(user);
      // Focus moves into the panel when it opens, so keyboard users land on the courses
      // rather than having to tab the whole rail.
      await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));

      await user.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Courses' })).toBeNull());
      expect(coursesButton()).toHaveFocus();
    });

    it('closes when the user clicks outside it', async () => {
      const user = userEvent.setup();
      renderSidebar({ open: false });

      await openCoursesFlyout(user);
      await user.click(screen.getByRole('link', { name: 'AFCT Dashboard' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Courses' })).toBeNull());
    });

    it('stays open while the Past Courses toggle inside it is used', async () => {
      const user = userEvent.setup();
      renderSidebar({ open: false });

      const panel = await openCoursesFlyout(user);
      await user.click(within(panel).getByRole('button', { name: /Past Courses/ }));

      expect(screen.getByRole('dialog', { name: 'Courses' })).toBeInTheDocument();
    });

    it('closes when the sidebar is expanded', async () => {
      const user = userEvent.setup();
      renderSidebar({ open: false });

      await openCoursesFlyout(user);
      await user.click(screen.getByRole('button', { name: 'Open sidebar' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Courses' })).toBeNull());
      expect(screen.getByRole('link', { name: /CS101/ })).toBeInTheDocument();
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
        user: {
          id: 'a1',
          email: 'admin@example.com',
          firstName: 'A',
          lastName: 'D',
          isAdmin: true,
        },
      },
    });
    renderSidebar();

    // `admin: 'yes'` is not a boolean, so the section falls back to its default (open)
    // rather than being coerced by a truthy string.
    const adminToggle = await screen.findByRole('button', { name: /Administration/ });
    expect(adminToggle).toHaveAttribute('aria-expanded', 'true');
  });
});
