'use client';

import React, { useState } from 'react';
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

export function JoinCourseModule() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    if (code.length !== 6) {
      toast.error('Please enter a valid 6-character registration code.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/courses/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join course');

      toast.success(`You have joined ${data.course.name}`);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unable to join course';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
      setCode(''); // ✅ Always clears boxes after click
    }
  };

  const handleClear = () => {
    setCode('');
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleJoin();
  };

  return (
    <Card className="w-full" aria-labelledby="join-course-title">
      <CardHeader>
        <CardTitle id="join-course-title" className="text-lg font-semibold">
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

            <InputOTP
              id="course-code"
              name="courseCode"
              aria-describedby="course-code-help"
              maxLength={6}
              value={code.toUpperCase()}
              onPaste={(e) => {
                e.preventDefault(); // Prevent the typical pasteing-in of data
                const pastedData = e.clipboardData.getData('text/plain'); // Get what the user is trying to paste
                const processedData = pastedData.replace(/[^A-Z0-9a-z]/g, ''); // Replace all characters that are not A-Z0-9a-z with whitespace
                setCode(processedData); // Set the processed data to the box
              }}
              onChange={setCode}
              pattern="[A-Z0-9a-z]+$"
              containerClassName="justify-start"
              className="mb-2"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
              </InputOTPGroup>
              <InputOTPSeparator>-</InputOTPSeparator>
              <InputOTPGroup>
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={loading || code.length !== 6}>
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
