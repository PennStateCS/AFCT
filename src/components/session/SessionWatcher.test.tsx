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
  window.localStorage.clear();
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

  it('heartbeats the server (update) on activity, throttled to the interval', () => {
    // 5-min window → heartbeat interval is 75s.
    render(<SessionWatcher />);
    updateMock.mockClear();

    // Activity before the interval elapses does not heartbeat.
    act(() => {
      vi.advanceTimersByTime(30_000);
      window.dispatchEvent(new MouseEvent('mousemove'));
    });
    expect(updateMock).not.toHaveBeenCalled();

    // Once past the interval, the next activity refreshes the server clock.
    act(() => {
      vi.advanceTimersByTime(50_000); // 80s total > 75s
      window.dispatchEvent(new MouseEvent('mousemove'));
    });
    expect(updateMock).toHaveBeenCalled();
  });

  it('signs out when the server marks the session inactive', () => {
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      update: updateMock,
      data: { user: { inactive: true } },
    });
    render(<SessionWatcher />);
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

/**
 * The idle clock is shared across tabs (localStorage), because sign-out clears the whole
 * browser's session: one window's view of "idle" must not end a session somebody is actively
 * using in another.
 */
describe('the shared activity clock', () => {
  it('does not sign out while another tab reports recent activity', () => {
    render(<SessionWatcher />);

    // Another tab wrote fresh activity moments before our deadline. This tab saw nothing.
    act(() => {
      vi.advanceTimersByTime(290_000);
      window.localStorage.setItem('afct.session.last-activity', String(Date.now() - 1_000));
      vi.advanceTimersByTime(20_000); // our own clock is now past 300s idle
    });

    expect(safeSignOutMock).not.toHaveBeenCalled();
  });

  it('takes the warning down when another tab extends while it is showing', () => {
    render(<SessionWatcher />);
    act(() => {
      vi.advanceTimersByTime(245_000);
    });
    expect(screen.getByText('Session Expiring')).toBeInTheDocument();

    act(() => {
      window.localStorage.setItem('afct.session.last-activity', String(Date.now()));
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.queryByText('Session Expiring')).not.toBeInTheDocument();
    expect(safeSignOutMock).not.toHaveBeenCalled();
  });

  // The shared value is client UX, not authority. A future timestamp is a wrong clock or a
  // planted value, and must not postpone the warning past what this tab can vouch for.
  it('ignores a shared timestamp from the future', () => {
    render(<SessionWatcher />);
    act(() => {
      window.localStorage.setItem('afct.session.last-activity', String(Date.now() + 900_000));
      vi.advanceTimersByTime(301_000);
    });
    expect(safeSignOutMock).toHaveBeenCalled();
  });
});

/**
 * A failed extend restores the warning rather than signing out: the request failed, not the
 * session, and a wifi blip at the moment of the click must not throw away somebody's work.
 */
describe('a failed extension', () => {
  it('puts the warning back instead of signing out', async () => {
    updateMock.mockRejectedValueOnce(new Error('network'));
    render(<SessionWatcher />);
    act(() => {
      vi.advanceTimersByTime(245_000);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Extend Session' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(safeSignOutMock).not.toHaveBeenCalled();
    expect(screen.getByText('Session Expiring')).toBeInTheDocument();

    // And a retry that succeeds still works.
    updateMock.mockResolvedValueOnce({ user: { inactive: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Extend Session' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('Session Expiring')).not.toBeInTheDocument();
  });

  it('still signs out when the server says the session is dead', async () => {
    updateMock.mockResolvedValueOnce({ user: { inactive: true } });
    render(<SessionWatcher />);
    act(() => {
      vi.advanceTimersByTime(245_000);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Extend Session' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(safeSignOutMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * The absolute cap gets its own warning, because "Extend Session" is a promise it cannot keep:
 * no activity moves that deadline, and the server refuses the session at it regardless.
 */
describe('the end-of-session notice', () => {
  const withCap = (endsInMs: number) =>
    useSessionMock.mockReturnValue({
      status: 'authenticated',
      update: updateMock,
      data: { user: { inactive: false }, sessionEndsAt: Date.now() + endsInMs },
    });

  it('warns five minutes before the cap, with no Extend button', () => {
    withCap(6 * 60_000);
    render(<SessionWatcher />);
    act(() => {
      vi.advanceTimersByTime(61_000); // inside the 5-minute lead
    });

    expect(screen.getByText('Your session is ending soon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Extend Session' })).not.toBeInTheDocument();
  });

  it('can be dismissed, and returns once inside the final minute', () => {
    withCap(6 * 60_000);
    render(<SessionWatcher />);
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue working' }));
    expect(screen.queryByText('Your session is ending soon')).not.toBeInTheDocument();

    act(() => {
      // Stay active while the cap approaches: the point of this warning is that activity
      // does not help, and an idle user would (rightly) hit the idle sign-out first.
      for (let i = 0; i < 25; i++) {
        vi.advanceTimersByTime(10_000);
        fireEvent.mouseMove(window);
      }
    });
    expect(screen.getByText('Your session is ending soon')).toBeInTheDocument();
    expect(safeSignOutMock).not.toHaveBeenCalled();
  });

  it('signs out at the cap however active the user is', () => {
    withCap(2 * 60_000);
    render(<SessionWatcher />);
    act(() => {
      // Constant activity: the idle path never fires, only the cap can.
      for (let i = 0; i < 13; i++) {
        vi.advanceTimersByTime(10_000);
        fireEvent.mouseMove(window);
      }
    });
    expect(safeSignOutMock).toHaveBeenCalled();
  });

  it('shows nothing for a session with no recorded end', () => {
    render(<SessionWatcher />);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(screen.queryByText('Your session is ending soon')).not.toBeInTheDocument();
  });
});
