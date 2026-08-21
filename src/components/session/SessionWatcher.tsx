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
/**
 * The idle clock, shared across tabs.
 *
 * Each mounted watcher used to keep its own `lastActivityRef`, and sign-out clears the session
 * cookie for the whole browser. So a second window left untouched, on another monitor or behind
 * the current tab, would reach its own idle limit and sign out somebody actively working in the
 * first, even though the server (which sees that tab's heartbeats) considered the session live.
 * The clock the sign-out decision reads has to be per-browser, like the thing it signs out of.
 *
 * localStorage rather than BroadcastChannel because the value must survive a tab that was asleep:
 * a throttled background tab misses messages, but reads storage fresh on its next tick.
 */
const ACTIVITY_STORAGE_KEY = 'afct.session.last-activity';

function readSharedActivity(): number | null {
  try {
    const raw = window.localStorage.getItem(ACTIVITY_STORAGE_KEY);
    const value = raw === null ? NaN : Number(raw);
    // A future timestamp is a wrong clock or a tampered value; either way it must not push the
    // warning out. This is UX only, the server enforces the real limit, but honest UX beats not.
    return Number.isFinite(value) && value <= Date.now() ? value : null;
  } catch {
    // Private browsing or a blocked store: each tab falls back to its own clock, which is the
    // old behaviour rather than a failure.
    return null;
  }
}

function writeSharedActivity(now: number): void {
  try {
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now));
  } catch {
    // Same as above: not being able to share the clock only costs the multi-tab nicety.
  }
}

/** How long before the absolute cap the save-your-work warning appears. */
const CAP_WARNING_LEAD_MS = 5 * 60 * 1000;

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

  /**
   * The absolute cap, from the server. Nothing the user does moves it, which is exactly why it
   * needs its own warning: "Extend Session" is a promise this one cannot keep.
   */
  const sessionEndsAt = session?.sessionEndsAt;
  const sessionEndsAtRef = useRef<number | undefined>(sessionEndsAt);
  useEffect(() => {
    sessionEndsAtRef.current = sessionEndsAt;
  }, [sessionEndsAt]);
  const [capWarningOpen, setCapWarningOpen] = useState(false);
  // Once dismissed, the cap warning stays away until the final minute, then returns once.
  const capWarningStageRef = useRef<0 | 1 | 2>(0);

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
    // Optimistically reset the idle clock and dismiss the warning, remembering what it was:
    // a failed request has to be able to put things back the way they were.
    const now = Date.now();
    const previousActivity = lastActivityRef.current;
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
      // The extension is real, so every tab's clock moves with it.
      writeSharedActivity(now);
      // Best-effort audit trail of the explicit extension.
      void fetch(apiPaths.sessionExtend(), { method: 'POST' }).catch(() => {});
    } catch {
      /**
       * The request failed, not the session. A laptop rejoining wifi at the moment of the
       * click used to be signed out here, which threw away work over a network blip the
       * server never even saw. Nothing has expired: put the warning back and let them try
       * again, and if the session really is dead the server refuses the next attempt with
       * an inactive session, which the branch above turns into a sign-out.
       */
      lastActivityRef.current = previousActivity;
      warningActiveRef.current = true;
      setShowModal(true);
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
    writeSharedActivity(now);

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
      // Shared, so a window on another monitor knows somebody is here. Throttled to the
      // heartbeat cadence: writing localStorage on every mousemove would be most of the work
      // this component does.
      if (t - lastHeartbeatRef.current >= heartbeatIntervalMs) {
        writeSharedActivity(t);
        sendHeartbeat();
      }
    };

    const tick = () => {
      if (signingOutRef.current) return;
      const now = Date.now();

      /**
       * The absolute cap comes first: it is the one deadline no activity moves, so nothing
       * below may reprieve it. At zero the server has already stopped honouring the session,
       * so signing out is reporting the truth rather than deciding anything.
       */
      const endsAt = sessionEndsAtRef.current;
      if (typeof endsAt === 'number') {
        const capRemaining = endsAt - now;
        if (capRemaining <= 0) {
          performSignOut();
          return;
        }
        // Two appearances: once at five minutes, and once more inside the final minute for
        // somebody who dismissed the first. More than that is nagging.
        if (capWarningStageRef.current === 0 && capRemaining <= CAP_WARNING_LEAD_MS) {
          capWarningStageRef.current = 1;
          setCapWarningOpen(true);
        } else if (capWarningStageRef.current === 1 && capRemaining <= 60_000) {
          capWarningStageRef.current = 2;
          setCapWarningOpen(true);
        }
      }

      /**
       * The idle clock is the freshest of this tab's own and the shared one, so activity in
       * any window keeps every window's countdown honest. Without this, the sign-out (which
       * clears the whole browser's session) was decided from one tab's view of "idle".
       */
      const shared = readSharedActivity();
      if (shared !== null && shared > lastActivityRef.current) {
        lastActivityRef.current = shared;
      }

      const remaining = lastActivityRef.current + timeoutMs - now;
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
      // Somebody extended, or worked, in another window while our warning was up: the shared
      // clock has moved and the warning no longer describes anything. Take it down.
      if (warningActiveRef.current && remaining > warningLeadMs) {
        warningActiveRef.current = false;
        setShowModal(false);
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
    <>
      {/**
       * The end-of-session notice, distinct from the idle warning on purpose: this deadline
       * cannot be extended, so offering "Extend Session" here would be a promise the client
       * cannot keep (the server refuses at the cap regardless). Dismissible, because the only
       * useful response is to save work and carry on until it happens.
       */}
      <Dialog open={capWarningOpen && !showModal} onOpenChange={setCapWarningOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your session is ending soon</DialogTitle>
            <DialogDescription>
              {sessionEndsAt
                ? `For security, every sign-in ends after a fixed time, and yours ends at ${new Date(
                    sessionEndsAt,
                  ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. `
                : 'For security, every sign-in ends after a fixed time. '}
              Save anything you are working on. Signing in again starts a fresh session, and nothing
              you have saved is affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCapWarningOpen(false)}>
              Continue working
            </Button>
            <Button variant="destructive" onClick={performSignOut}>
              Sign out now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showModal} onOpenChange={() => {}}>
        {/* No close button: dismissal is an explicit choice (Extend or Log out), and
          onOpenChange is a deliberate no-op, so a rendered X would be inert. */}
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Session Expiring</DialogTitle>
            <DialogDescription>
              Your session will expire in <strong>{timeDisplay}</strong> {timeUnit} due to
              inactivity.
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
    </>
  );
}
