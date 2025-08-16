'use client';

import { useSession, signOut } from 'next-auth/react';
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

// Constants moved outside component to avoid dependency issues
const INACTIVITY_LIMIT = 5 * 60 * 1000; // 5 minutes
const WARNING_TIME = 60 * 1000; // 1 minute
const TOTAL_COUNTDOWN = 60; // 60 seconds

export default function SessionWatcher() {
  const { data: session, status, update } = useSession();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const inactivityRef = useRef<NodeJS.Timeout | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);

  // Always run hooks, but guard effects with conditions
  useEffect(() => {
    if (status !== 'authenticated' || !session?.user) return;

    const handleActivity = () => {
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      inactivityRef.current = setTimeout(triggerWarning, INACTIVITY_LIMIT);
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    handleActivity();

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
    };
  }, [status, session]);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.expires) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    const expiration = new Date(session.expires).getTime();
    const now = Date.now();
    const timeout = expiration - now;

    if (timeout > 0) {
      timerRef.current = setTimeout(triggerWarning, Math.max(timeout - WARNING_TIME, 0));
    } else {
      signOut({ callbackUrl: '/login' });
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [status, session]);

  const triggerWarning = () => {
    setShowModal(true);
    setTimeLeft(TOTAL_COUNTDOWN);

    if (countdownRef.current) clearInterval(countdownRef.current);

    const start = Date.now();
    countdownRef.current = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const remaining = Math.max(TOTAL_COUNTDOWN - elapsed, 0);
      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(countdownRef.current!);
        signOut({ callbackUrl: '/login' });
      }
    }, 100);
  };

  const extendSession = async () => {
    try {
      const res = await fetch('/api/session/extend', { method: 'POST' });
      const data = await res.json();

      if (data.ok) {
        setShowModal(false);
        if (countdownRef.current) clearInterval(countdownRef.current);
        if (inactivityRef.current) clearTimeout(inactivityRef.current);
        inactivityRef.current = setTimeout(triggerWarning, INACTIVITY_LIMIT);
        await update();
      } else {
        signOut({ callbackUrl: '/login' });
      }
    } catch (err) {
      console.error('Failed to extend session', err);
      signOut({ callbackUrl: '/login' });
    }
  };

  const progressValue = (timeLeft / TOTAL_COUNTDOWN) * 100;
  const displaySeconds = Math.ceil(timeLeft);

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
            Your session will expire in <strong>{displaySeconds}</strong> seconds due to inactivity.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4">
          <Progress value={progressValue} className="h-2 transition-all duration-100" />
        </div>

        <DialogFooter className="flex justify-end gap-2">
          <Button variant="secondary" onClick={extendSession}>
            Extend Session
          </Button>
          <Button variant="destructive" onClick={() => signOut({ callbackUrl: '/login' })}>
            Logout Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
