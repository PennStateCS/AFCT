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
    default: ({ href, children }: { href: string; children: React.ReactNode }) => (
      <a href={href}>{children}</a>
    ),
  };
});

vi.mock('@/components/ui/sidebar', () => {
  const React = require('react');
  return {
    SidebarHeader: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="sidebar-header">{children}</div>
    ),
    SidebarMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SidebarMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
    useSidebar: () => useSidebarMock(),
  };
});

vi.mock('@/components/ui/tooltip', () => {
  const React = require('react');
  const PassThrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    TooltipProvider: PassThrough,
    TooltipTrigger: PassThrough,
    TooltipContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="tooltip-content">{children}</div>
    ),
    Tooltip: ({ children, open }: { children: React.ReactNode; open?: boolean }) => (
      <div data-testid="tooltip" data-open={open === undefined ? 'undefined' : String(open)}>
        {children}
      </div>
    ),
  };
});

import DashboardSidebarHeader from './DashboardSidebarHeader';

beforeEach(() => {
  vi.clearAllMocks();
  useSidebarMock.mockReturnValue({ state: 'expanded' });
  usePathnameMock.mockReturnValue('/dashboard');
});

describe('DashboardSidebarHeader', () => {
  it('marks the dashboard link active when the pathname matches', () => {
    render(<DashboardSidebarHeader />);

    expect(screen.getByRole('link', { name: 'AFCT Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.getByTestId('sidebar-menu-button').dataset.active).toBe('true');
  });

  it('keeps the tooltip closed while expanded', () => {
    render(<DashboardSidebarHeader />);

    expect(screen.getByTestId('tooltip').dataset.open).toBe('false');
  });

  it('lets the tooltip manage visibility when collapsed', () => {
    useSidebarMock.mockReturnValue({ state: 'collapsed' });

    render(<DashboardSidebarHeader />);

    expect(screen.getByTestId('tooltip').dataset.open).toBe('undefined');
  });
});
