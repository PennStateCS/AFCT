/** @vitest-environment jsdom */

// JSX in this file compiles to React.createElement (classic runtime), so React is
// a runtime value, not a type-only import.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, beforeEach, expect, vi } from 'vitest';

const useSidebarMock = vi.fn();
const usePathnameMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock('next/link', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  };
});

vi.mock('@/components/ui/sidebar', () => {
  const React = require('react');
  return {
    SidebarHeader: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="sidebar-header">{children}</div>
    ),
    useSidebar: () => useSidebarMock(),
  };
});

vi.mock('@/components/ui/tooltip', () => {
  const React = require('react');
  const PassThrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    TooltipProvider: PassThrough,
    TooltipTrigger: PassThrough,
    TooltipContent: ({ children, hidden }: { children: React.ReactNode; hidden?: boolean }) => (
      <div data-testid="tooltip-content" data-hidden={hidden ? 'true' : 'false'}>
        {children}
      </div>
    ),
    Tooltip: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="tooltip">{children}</div>
    ),
  };
});

import DashboardSidebarHeader from './DashboardSidebarHeader';

/** The real mark, deliberately not mocked: whether it renders at all is half of this. */
const mark = () => document.querySelector('[data-testid="sidebar-header"] svg');

beforeEach(() => {
  vi.clearAllMocks();
  useSidebarMock.mockReturnValue({ state: 'expanded', isMobile: false, setOpenMobile: vi.fn() });
  usePathnameMock.mockReturnValue('/dashboard');
});

describe('the expanded sidebar brand', () => {
  it('shows the mark, the wordmark and the tracked second line', () => {
    render(<DashboardSidebarHeader />);

    expect(mark()).toBeInTheDocument();
    expect(screen.getByText('AFCT')).toBeVisible();
    expect(screen.getByText('Dashboard')).toBeVisible();
  });

  /*
   * The two visible lines are a wordmark, not a sentence, and there is also an sr-only name
   * for the icon rail. Read out, that is three sources for one name, and the failure it
   * produces is a link announced as "AFCT Dashboard AFCT Dashboard" rather than anything
   * obviously broken on screen. One accessible name, in every state.
   */
  it('is one link named AFCT Dashboard, not two names concatenated', () => {
    render(<DashboardSidebarHeader />);

    const link = screen.getByRole('link', { name: 'AFCT Dashboard' });
    expect(link).toHaveAttribute('href', '/dashboard');
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('marks itself as the current page while on the dashboard', () => {
    render(<DashboardSidebarHeader />);

    expect(screen.getByRole('link', { name: 'AFCT Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('claims nothing about the current page elsewhere', () => {
    usePathnameMock.mockReturnValue('/dashboard/courses');
    render(<DashboardSidebarHeader />);

    expect(screen.getByRole('link', { name: 'AFCT Dashboard' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('hides the tooltip, since the name is already on screen', () => {
    render(<DashboardSidebarHeader />);

    expect(screen.getByTestId('tooltip-content').dataset.hidden).toBe('true');
  });
});

/*
 * The 56px rail. A wordmark cannot fit, and half of one reads as a rendering fault, so the
 * text goes entirely and the tooltip carries the name instead.
 */
describe('the collapsed icon rail', () => {
  beforeEach(() => {
    useSidebarMock.mockReturnValue({ state: 'collapsed', isMobile: false, setOpenMobile: vi.fn() });
  });

  it('shows the mark alone', () => {
    render(<DashboardSidebarHeader />);

    expect(mark()).toBeInTheDocument();
    expect(screen.queryByText('AFCT')).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
  });

  it('still names the link, which is now the only thing that does', () => {
    render(<DashboardSidebarHeader />);

    expect(screen.getByRole('link', { name: 'AFCT Dashboard' })).toBeInTheDocument();
  });

  it('shows the tooltip, since nothing else says what the mark is', () => {
    render(<DashboardSidebarHeader />);

    expect(screen.getByTestId('tooltip-content').dataset.hidden).toBe('false');
  });
});

/*
 * `state` tracks the DESKTOP sidebar and survives across breakpoints, so a drawer opened after
 * the rail was collapsed reports 'collapsed' while being 288px wide. Without the isMobile test
 * the phone gets a lone mark in a drawer with room for the whole lockup.
 */
describe('the mobile drawer', () => {
  beforeEach(() => {
    useSidebarMock.mockReturnValue({ state: 'collapsed', isMobile: true, setOpenMobile: vi.fn() });
  });

  it('shows the full brand even while the desktop sidebar is collapsed', () => {
    render(<DashboardSidebarHeader />);

    expect(mark()).toBeInTheDocument();
    expect(screen.getByText('AFCT')).toBeVisible();
    expect(screen.getByText('Dashboard')).toBeVisible();
  });

  it('closes the drawer when the brand is followed', async () => {
    const setOpenMobile = vi.fn();
    useSidebarMock.mockReturnValue({ state: 'expanded', isMobile: true, setOpenMobile });
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<DashboardSidebarHeader />);

    await userEvent.click(screen.getByRole('link', { name: 'AFCT Dashboard' }));

    expect(setOpenMobile).toHaveBeenCalledWith(false);
  });
});
