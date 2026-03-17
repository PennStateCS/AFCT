'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
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
import { clampSessionTimeoutMinutes, DEFAULT_SESSION_TIMEOUT_MINUTES } from '@/lib/system-settings';

type PublicSystemSettingsResponse = {
  sessionTimeoutMinutes?: number;
};

export default function SessionWatcher() {
  const { data: session, status, update } = useSession();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const inactivityRef = useRef<NodeJS.Timeout | null>(null);
  const warningActiveRef = useRef(false);
  const signingOutRef = useRef(false);
  const extendingRef = useRef(false);

  const [showModal, setShowModal] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const [isExtending, setIsExtending] = useState(false);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(
    DEFAULT_SESSION_TIMEOUT_MINUTES,
  );

  const inactivityLimitMs = sessionTimeoutMinutes * 60 * 1000;
  const totalCountdown = Math.min(300, Math.max(60, Math.floor((sessionTimeoutMinutes * 60) / 4)));

  const performSignOut = () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;

    if (timerRef.current) clearTimeout(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (inactivityRef.current) clearTimeout(inactivityRef.current);

    void safeSignOut({ callbackUrl: '/login' });
  };

  useEffect(() => {
    if (status !== 'authenticated') return;

    let active = true;

    const loadSettings = async () => {
      try {
        const res = await fetch('/api/system-settings/public', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as PublicSystemSettingsResponse;
        if (!active) return;
        setSessionTimeoutMinutes(
          clampSessionTimeoutMinutes(
            Number(data.sessionTimeoutMinutes) || DEFAULT_SESSION_TIMEOUT_MINUTES,
          ),
        );
      } catch {
        if (!active) return;
        setSessionTimeoutMinutes(DEFAULT_SESSION_TIMEOUT_MINUTES);
      }
    };

    void loadSettings();

    return () => {
      active = false;
    };
  }, [status]);

  // Always run hooks, but guard effects with conditions
  useEffect(() => {
    if (status !== 'authenticated' || !session?.user) return;

    const handleActivity = () => {
      if (warningActiveRef.current || signingOutRef.current) return;
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      inactivityRef.current = setTimeout(triggerWarning, inactivityLimitMs);
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('pointerdown', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('touchstart', handleActivity, { passive: true });
    window.addEventListener('scroll', handleActivity, { passive: true });
    handleActivity();

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('scroll', handleActivity);
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
    };
  }, [status, session, inactivityLimitMs]);

  const triggerWarning = () => {
    if (warningActiveRef.current || signingOutRef.current) return;

    warningActiveRef.current = true;
    setShowModal(true);
    setTimeLeft(totalCountdown);

    if (countdownRef.current) clearInterval(countdownRef.current);

    const start = Date.now();
    countdownRef.current = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const remaining = Math.max(totalCountdown - elapsed, 0);
      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        performSignOut();
      }
    }, 100);
  };

  const extendSession = async () => {
    if (extendingRef.current || signingOutRef.current) return;

    extendingRef.current = true;
    setIsExtending(true);

    try {
      const res = await fetch('/api/session/extend', { method: 'POST' });
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;

      if (res.ok && data?.ok) {
        warningActiveRef.current = false;
        setShowModal(false);
        if (countdownRef.current) clearInterval(countdownRef.current);
        if (inactivityRef.current) clearTimeout(inactivityRef.current);
        inactivityRef.current = setTimeout(triggerWarning, inactivityLimitMs);
        await update();
      } else {
        performSignOut();
      }
    } catch (err) {
      console.error('Failed to extend session', err);
      performSignOut();
    } finally {
      extendingRef.current = false;
      setIsExtending(false);
    }
  };

  const progressValue = (timeLeft / totalCountdown) * 100;
  const wholeSeconds = Math.max(0, Math.ceil(timeLeft));
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

  // Render guard AFTER all hooks
  if (status !== 'authenticated' || !session?.user) {
    return null;
  }

  return (
    <Dialog open={showModal} onOpenChange={() => {}}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Session Expiring</DialogTitle>
          <DialogDescription>
            Your session will expire in <strong>{timeDisplay}</strong> {timeUnit} due to inactivity.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4">
          <Progress value={progressValue} className="h-2 transition-all duration-100" />
        </div>

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
