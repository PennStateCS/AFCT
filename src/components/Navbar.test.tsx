/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const setThemeMock = vi.fn();
const useSessionMock = vi.fn();
const usePathnameMock = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => useSessionMock(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ setTheme: setThemeMock }),
}));

vi.mock('./ui/EnhancedSidebarTrigger', () => ({
  EnhancedSidebarTrigger: () => <div data-testid="sidebar-trigger" />,
}));

vi.mock('@/components/ui/dropdown-menu', () => {
  const React = require('react');
  return {
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
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

import Navbar from './Navbar';

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  (globalThis as any).fetch = fetchMock;
});

afterAll(() => {
  (globalThis as any).fetch = originalFetch;
});

describe('Navbar', () => {
  it('renders a placeholder nav while the session is loading', () => {
    useSessionMock.mockReturnValue({ status: 'loading' });
    usePathnameMock.mockReturnValue('/');

    const { container } = render(<Navbar />);

    const nav = container.querySelector('nav');
    expect(nav).not.toBeNull();
    expect(nav?.textContent).toBe('');
  });

  it('returns null when no user data is available', () => {
    useSessionMock.mockReturnValue({ status: 'authenticated', data: { user: null } });
    usePathnameMock.mockReturnValue('/');

    const { container } = render(<Navbar />);

    expect(container.firstChild).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows user details and breadcrumb labels fetched from APIs', async () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      data: {
        user: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          name: 'Ada Lovelace',
          role: 'ADMIN',
          avatar: 'ada.png',
        },
      },
    });
    usePathnameMock.mockReturnValue('/app/courses/course-123/assignment-456');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ name: 'Course Alpha' }),
    } as unknown as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: 'Assignment Beta' }),
    } as unknown as Response);

    render(<Navbar />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/courses/course-123');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/courses/course-123/assignment-456');

    await waitFor(() => expect(screen.getByText('Course Alpha')).toBeInTheDocument());
    expect(screen.getByText('Assignment Beta')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByLabelText('User avatar')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Dark'));
    expect(setThemeMock).toHaveBeenCalledWith('dark');
  });
});
