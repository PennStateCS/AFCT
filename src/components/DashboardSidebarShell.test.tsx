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
    expect(screen.getByTestId('sidebar-menu')).toBeInTheDocument();

    // Full bleed, so the rule reaches both edges of the rail rather than floating inside it
    // with the primitive's default 8px inset. The gap under it is a spacing decision that can
    // move; pinning the exact class made a 6px change a test failure with nothing to say.
    expect(screen.getByTestId('sidebar-separator')).toHaveClass('!mx-0');
  });

  // Brand, rule, navigation, in that order. Reversing them or dropping the rule is the whole
  // of what would make the header stop reading as a header.
  it('puts the divider between the brand and the navigation', () => {
    const { container } = render(<DashboardSidebarShell />);

    const order = ['sidebar-header', 'sidebar-separator', 'sidebar-menu'].map((id) =>
      [...container.querySelectorAll('[data-testid]')].findIndex(
        (el) => el.getAttribute('data-testid') === id,
      ),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it('configures the sidebar with icon collapse mode', () => {
    render(<DashboardSidebarShell />);

    expect(SidebarMock).toHaveBeenCalledWith(
      expect.objectContaining({ collapsible: 'icon', className: 'h-full overflow-x-hidden' }),
    );
  });
});
