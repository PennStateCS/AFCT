'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { safeSignOut } from '@/lib/safe-signout';
import { apiPaths } from '@/lib/api-paths';
import { useSessionTimeoutMinutes } from '@/hooks/use-public-system-settings';
import {
  sessionTimeoutMs,
  computeWarningLeadMs,
  computeHeartbeatIntervalMs,
} from '@/lib/session-timeout';

/**
 * Idle-session watcher. Signs the user out after a configurable stretch of no
 * interaction, warning them shortly beforehand with a chance to stay signed in.
 *
 * Everything is driven by wall-clock deadlines (`lastActivity + timeout`), not by
 * decrementing timers, and it re-evaluates on `visibilitychange`/`focus`. So when
 * a machine is locked or the tab is suspended (which freezes JS timers) the
 * watcher signs out (or shows the correct remaining time) the instant the tab is
 * visible again, instead of resuming a stale countdown. It also heartbeats the
 * server (via `update()`) on real activity so the server-side idle enforcement in
 * the middleware/auth callbacks stays in sync with what the user is doing.
 *
 * Mount this inside the dashboard's `QueryProvider` so the settings read shares
 * the app query cache; it renders nothing until the user is authenticated.
 */
export default function SessionWatcher() {
  const { data: session, status, update } = useSession();
  const timeoutMinutes = useSessionTimeoutMinutes();

  const timeoutMs = sessionTimeoutMs(timeoutMinutes);
  const warningLeadMs = computeWarningLeadMs(timeoutMs);
  const heartbeatIntervalMs = computeHeartbeatIntervalMs(timeoutMs);

  const lastActivityRef = useRef(Date.now());
  const lastHeartbeatRef = useRef(Date.now());
  const warningActiveRef = useRef(false);
  const signingOutRef = useRef(false);
  // `update` gets a new identity on each render; hold it in a ref so the timer
  // effect below doesn't need it as a dependency (which would restart the timer).
  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  });

  const [showModal, setShowModal] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [isExtending, setIsExtending] = useState(false);

  const performSignOut = useCallback(() => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    void safeSignOut({ callbackUrl: '/login' });
  }, []);

  // The server revokes a session by marking it inactive (idle-timeout lapsed, or
  // the account was disabled/deleted). `useSession` still reports "authenticated"
  // in that case, so without this the user is left on a half-broken page (cleared
  // query cache, hidden admin menu, background 401s) instead of being redirected.
  // Sign out the moment a session comes back inactive.
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.inactive) {
      performSignOut();
    }
  }, [status, session, performSignOut]);

  const extendSession = useCallback(async () => {
    if (signingOutRef.current) return;
    setIsExtending(true);
    // Optimistically reset the local idle clock and dismiss the warning.
    const now = Date.now();
    lastActivityRef.current = now;
    lastHeartbeatRef.current = now;
    warningActiveRef.current = false;
    setShowModal(false);
    try {
      // Refresh the server's idle clock. If the server already considers us
      // idle-expired it returns an inactive session; honor that over the UI.
      const updated = await updateRef.current({ activity: now });
      const inactive = (updated?.user as { inactive?: boolean } | undefined)?.inactive;
      if (inactive) {
        performSignOut();
        return;
      }
      // Best-effort audit trail of the explicit extension.
      void fetch(apiPaths.sessionExtend(), { method: 'POST' }).catch(() => {});
    } catch {
      performSignOut();
    } finally {
      setIsExtending(false);
    }
  }, [performSignOut]);

  useEffect(() => {
    if (status !== 'authenticated' || timeoutMs <= 0) return;

    const now = Date.now();
    lastActivityRef.current = now;
    lastHeartbeatRef.current = now;
    warningActiveRef.current = false;
    signingOutRef.current = false;
    setShowModal(false);

    const sendHeartbeat = () => {
      lastHeartbeatRef.current = Date.now();
      void updateRef.current({ activity: Date.now() }).catch(() => {});
    };

    const handleActivity = () => {
      // While the warning is up, passive activity is ignored; the user must
      // click "Extend" to prove they're really there.
      if (signingOutRef.current || warningActiveRef.current) return;
      const t = Date.now();
      lastActivityRef.current = t;
      if (t - lastHeartbeatRef.current >= heartbeatIntervalMs) sendHeartbeat();
    };

    const tick = () => {
      if (signingOutRef.current) return;
      const remaining = lastActivityRef.current + timeoutMs - Date.now();
      if (remaining <= 0) {
        // Past the hard limit, including the case where timers were frozen by a
        // lock/suspend and we only just became visible again.
        performSignOut();
        return;
      }
      if (!warningActiveRef.current && remaining <= warningLeadMs) {
        warningActiveRef.current = true;
        setShowModal(true);
      }
      if (warningActiveRef.current) setRemainingMs(remaining);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('pointerdown', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('touchstart', handleActivity, { passive: true });
    window.addEventListener('scroll', handleActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);

    const intervalId = setInterval(tick, 1000);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [status, timeoutMs, warningLeadMs, heartbeatIntervalMs, performSignOut]);

  const progressValue =
    warningLeadMs > 0 ? Math.max(0, Math.min(100, (remainingMs / warningLeadMs) * 100)) : 0;
  const wholeSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const displayMinutes = Math.floor(wholeSeconds / 60);
  const displaySeconds = wholeSeconds % 60;
  const timeDisplay =
    displayMinutes > 0
      ? `${displayMinutes}:${displaySeconds.toString().padStart(2, '0')}`
      : `${wholeSeconds}`;
  const timeUnit =
    displayMinutes > 0
      ? displayMinutes === 1
        ? 'minute'
        : 'minutes'
      : wholeSeconds === 1
        ? 'second'
        : 'seconds';

  // Screen-reader countdown, throttled so it isn't announced every second: step in
  // ~15s buckets until the final 10s, then each second. aria-live only fires when
  // this string changes, so the announcement follows those coarse steps.
  const announceSeconds = wholeSeconds <= 10 ? wholeSeconds : Math.ceil(wholeSeconds / 15) * 15;
  const announceMinutes = Math.floor(announceSeconds / 60);
  const announceRemSeconds = announceSeconds % 60;
  const countdownAnnouncement =
    !showModal || announceSeconds <= 0
      ? ''
      : announceMinutes > 0
        ? `Session expires in about ${announceMinutes} minute${announceMinutes === 1 ? '' : 's'}${
            announceRemSeconds ? ` ${announceRemSeconds} seconds` : ''
          }.`
        : `Session expires in ${announceSeconds} second${announceSeconds === 1 ? '' : 's'}.`;

  if (status !== 'authenticated') return null;

  return (
    <Dialog open={showModal} onOpenChange={() => {}}>
      {/* No close button: dismissal is an explicit choice (Extend or Log out), and
          onOpenChange is a deliberate no-op, so a rendered X would be inert. */}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Session Expiring</DialogTitle>
          <DialogDescription>
            Your session will expire in <strong>{timeDisplay}</strong> {timeUnit} due to inactivity.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4">
          <Progress
            value={progressValue}
            aria-label="Time remaining before automatic sign-out"
            className="h-2 transition-all duration-1000 ease-linear"
          />
        </div>

        {/* Throttled countdown for screen readers (the visible timer ticks every
            second, which would be far too chatty to announce). */}
        <span className="sr-only" role="timer" aria-live="polite">
          {countdownAnnouncement}
        </span>

        <DialogFooter className="flex justify-end gap-2">
          <Button variant="secondary" onClick={extendSession} disabled={isExtending}>
            {isExtending ? 'Extending...' : 'Extend Session'}
          </Button>
          <Button variant="destructive" onClick={performSignOut}>
            Logout Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
