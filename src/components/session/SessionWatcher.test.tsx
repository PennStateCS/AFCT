/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const useSessionMock = vi.hoisted(() => vi.fn());
const safeSignOutMock = vi.hoisted(() => vi.fn());
const useSessionTimeoutMinutesMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock('next-auth/react', () => ({ useSession: useSessionMock }));
vi.mock('@/lib/safe-signout', () => ({ safeSignOut: safeSignOutMock }));
vi.mock('@/hooks/use-public-system-settings', () => ({
  useSessionTimeoutMinutes: useSessionTimeoutMinutesMock,
}));

import SessionWatcher from './SessionWatcher';

// 5-minute idle window: warning shows at 240s (60s lead), hard logout at 300s.
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  updateMock.mockResolvedValue({ user: { inactive: false } });
  useSessionMock.mockReturnValue({ status: 'authenticated', update: updateMock });
  useSessionTimeoutMinutesMock.mockReturnValue(5);
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch;
  window.matchMedia =
    window.matchMedia ||
    (() =>
      ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }) as unknown as MediaQueryList);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SessionWatcher', () => {
  it('renders nothing when unauthenticated', () => {
    useSessionMock.mockReturnValue({ status: 'unauthenticated', update: updateMock });
    render(<SessionWatcher />);
    expect(screen.queryByText('Session Expiring')).not.toBeInTheDocument();
  });

  it('shows the warning near the deadline, then signs out at it', () => {
    render(<SessionWatcher />);
    act(() => {
      vi.advanceTimersByTime(245_000); // 245s idle → 55s left → warn
    });
    expect(screen.getByText('Session Expiring')).toBeInTheDocument();
    expect(safeSignOutMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(60_000); // past the 300s hard limit
    });
    expect(safeSignOutMock).toHaveBeenCalledTimes(1);
  });

  it('signs out immediately on return when timers were frozen past the deadline', () => {
    render(<SessionWatcher />);
    // Simulate a lock/suspend: the wall clock jumps past the deadline but the
    // interval never fired. Becoming visible again must re-evaluate and sign out.
    act(() => {
      vi.setSystemTime(400_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(safeSignOutMock).toHaveBeenCalledTimes(1);
  });

  it('extending dismisses the warning and pings the server', async () => {
    render(<SessionWatcher />);
    act(() => {
      vi.advanceTimersByTime(245_000);
    });
    expect(screen.getByText('Session Expiring')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /extend session/i }));
    });

    expect(updateMock).toHaveBeenCalled();
    expect(screen.queryByText('Session Expiring')).not.toBeInTheDocument();
    expect(safeSignOutMock).not.toHaveBeenCalled();
  });

  it('signs out if the server reports the session already went inactive', async () => {
    updateMock.mockResolvedValue({ user: { inactive: true } });
    render(<SessionWatcher />);
    act(() => {
      vi.advanceTimersByTime(245_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /extend session/i }));
    });
    expect(safeSignOutMock).toHaveBeenCalledTimes(1);
  });

  it('logs out immediately from the "Logout Now" button', () => {
    render(<SessionWatcher />);
    act(() => {
      vi.advanceTimersByTime(245_000);
    });
    fireEvent.click(screen.getByRole('button', { name: /logout now/i }));
    expect(safeSignOutMock).toHaveBeenCalledTimes(1);
  });
});
