'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '@/components/ui/input-otp';
import { apiPaths } from '@/lib/api-paths';

// Registration codes are 8 characters (see src/lib/course-code.ts).
const CODE_LENGTH = 8;
const cleanCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function JoinCourseModule() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const autoJoinedRef = useRef(false);

  const joinWithCode = useCallback(async (rawCode: string) => {
    const clean = cleanCode(rawCode);
    if (clean.length !== CODE_LENGTH) {
      toast.error(`Please enter a valid ${CODE_LENGTH}-character registration code.`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(apiPaths.courseJoin(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: clean }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join course');

      toast.success(`You have joined ${data.course.name}`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unable to join course';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
      setCode(''); // Always clear the boxes after an attempt.
    }
  }, []);

  // Join straight from a shared link: /dashboard?joinCode=XXXXXXXX. Runs once; the
  // param is stripped afterward so a refresh doesn't re-attempt the join.
  useEffect(() => {
    if (autoJoinedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const linkCode = params.get('joinCode');
    if (!linkCode) return;
    autoJoinedRef.current = true;

    const clean = cleanCode(linkCode).slice(0, CODE_LENGTH);
    setCode(clean);
    params.delete('joinCode');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));

    if (clean.length === CODE_LENGTH) void joinWithCode(clean);
  }, [joinWithCode]);

  const handleClear = () => setCode('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void joinWithCode(code);
  };

  return (
    <Card className="w-full" aria-labelledby="join-course-title">
      <CardHeader>
        <CardTitle
          id="join-course-title"
          role="heading"
          aria-level={2}
          className="text-lg font-semibold"
        >
          Join a Course
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="course-code" className="mb-2 text-sm">
              Enter a registration code below:
            </Label>
            <p id="course-code-help" className="text-muted-foreground mb-3 text-xs">
              You can only join while the course registration window is open.
            </p>

            {/* min-w-0 lets the slots compress in a narrow module column instead of
                overflowing into a horizontal scrollbar; at normal widths they render
                at their default 36px. */}
            <InputOTP
              id="course-code"
              name="courseCode"
              aria-describedby="course-code-help"
              maxLength={CODE_LENGTH}
              value={code.toUpperCase()}
              onPaste={(e) => {
                e.preventDefault(); // Prevent pasting raw data
                const pastedData = e.clipboardData.getData('text/plain');
                setCode(cleanCode(pastedData).slice(0, CODE_LENGTH));
              }}
              onChange={setCode}
              pattern="[A-Z0-9a-z]+$"
              containerClassName="justify-start"
              className="mb-2"
            >
              <InputOTPGroup className="min-w-0">
                <InputOTPSlot index={0} className="min-w-0" />
                <InputOTPSlot index={1} className="min-w-0" />
                <InputOTPSlot index={2} className="min-w-0" />
                <InputOTPSlot index={3} className="min-w-0" />
              </InputOTPGroup>
              <InputOTPSeparator>-</InputOTPSeparator>
              <InputOTPGroup className="min-w-0">
                <InputOTPSlot index={4} className="min-w-0" />
                <InputOTPSlot index={5} className="min-w-0" />
                <InputOTPSlot index={6} className="min-w-0" />
                <InputOTPSlot index={7} className="min-w-0" />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={loading || code.length !== CODE_LENGTH}>
              {loading ? 'Joining...' : 'Join'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleClear}
              disabled={code.length === 0}
            >
              Clear
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
