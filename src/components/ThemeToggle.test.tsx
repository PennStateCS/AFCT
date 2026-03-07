/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeToggler } from './ThemeToggle';

const setThemeMock = vi.fn();

vi.mock('next-themes', () => ({
  useTheme: () => ({
    setTheme: setThemeMock,
  }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button onClick={onClick} type="button">
      {children}
    </button>
  ),
}));

describe('ThemeToggler', () => {
  beforeEach(() => {
    setThemeMock.mockReset();
  });

  it('renders toggle label and theme choices', () => {
    render(<ThemeToggler />);

    expect(screen.getByText('Toggle theme')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System' })).toBeInTheDocument();
  });

  it('calls setTheme when a theme option is selected', async () => {
    const user = userEvent.setup();
    render(<ThemeToggler />);

    await user.click(screen.getByRole('button', { name: 'Light' }));
    await user.click(screen.getByRole('button', { name: 'Dark' }));
    await user.click(screen.getByRole('button', { name: 'System' }));

    expect(setThemeMock).toHaveBeenNthCalledWith(1, 'light');
    expect(setThemeMock).toHaveBeenNthCalledWith(2, 'dark');
    expect(setThemeMock).toHaveBeenNthCalledWith(3, 'system');
  });
});
