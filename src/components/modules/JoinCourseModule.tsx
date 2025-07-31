'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
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
      toast.error('Please enter a valid 6-character course code.');
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
    } catch (err: any) {
      toast.error(err.message || 'Unable to join course');
    } finally {
      setLoading(false);
      setCode(''); // ✅ Always clears boxes after click
    }
  };

  const handleClear = () => {
    setCode('');
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl font-semibold tracking-tight">Join a Course</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="course-code" className="text-muted-foreground text-sm font-medium">
            Course Code
          </Label>

          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            pattern="[A-Z0-9a-z]"
            containerClassName="justify-start"
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
        <div className="flex gap-2">
          <Button onClick={handleJoin} disabled={loading || code.length !== 6}>
            {loading ? 'Joining...' : 'Join'}
          </Button>
          <Button variant="secondary" onClick={handleClear} disabled={code.length === 0}>
            Clear
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
