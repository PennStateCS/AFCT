/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const SidebarMock = vi.fn(({ children, ...props }: any) => (
  <div data-testid="sidebar" data-collapsible={props.collapsible} className={props.className}>
    {children}
  </div>
));
const SidebarSeparatorSpy = vi.fn();

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: (props: any) => SidebarMock(props),
  SidebarSeparator: ({ className }: { className?: string }) => {
    SidebarSeparatorSpy(className);
    return <div data-testid="sidebar-separator" className={className} />;
  },
}));

const HeaderMock = vi.fn(() => <div data-testid="sidebar-header" />);
const MenuMock = vi.fn(() => <div data-testid="sidebar-menu" />);

vi.mock('@/components/DashboardSidebarHeader', () => ({
  __esModule: true,
  default: () => HeaderMock(),
}));

vi.mock('@/components/DashboardSidebarMenu', () => ({
  __esModule: true,
  default: () => MenuMock(),
}));

import DashboardSidebarShell from './DashboardSidebarShell';

beforeEach(() => {
  SidebarMock.mockClear();
  SidebarSeparatorSpy.mockClear();
  HeaderMock.mockClear();
  MenuMock.mockClear();
});

describe('DashboardSidebarShell', () => {
  it('renders the header, separator, and menu inside the sidebar', () => {
    render(<DashboardSidebarShell />);

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-header')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-separator')).toHaveClass('!mx-0 !mb-0');
    expect(screen.getByTestId('sidebar-menu')).toBeInTheDocument();
  });

  it('configures the sidebar with icon collapse mode', () => {
    render(<DashboardSidebarShell />);

    expect(SidebarMock).toHaveBeenCalledWith(
      expect.objectContaining({ collapsible: 'icon', className: 'h-full overflow-x-hidden' }),
    );
  });
});
