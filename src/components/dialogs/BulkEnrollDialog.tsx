'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useState, useEffect, useRef } from 'react';
import type { EnrollableUser } from '@/types/course';
import { apiPaths } from '@/lib/api-paths';

type Props = {
  open: boolean;
  setOpen: (v: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  // callback after enrollments complete
  onComplete?: () => void;
};

export default function BulkEnrollDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  onComplete,
}: Props) {
  const [step, setStep] = useState(1);
  const [rawText, setRawText] = useState('');
  const [found, setFound] = useState<EnrollableUser[]>([]);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isEnrolling, setIsEnrolling] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setRawText('');
      setFound([]);
      setNotFound([]);
      setIsLoading(false);
      setIsEnrolling(false);
    }
  }, [open]);

  const parseEmails = (text: string) => {
    const lines = text
      .split(/\r?\n|,|;|\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    // normalize to lower-case emails
    return Array.from(new Set(lines.map((e) => e.toLowerCase())));
  };

  const handleNextFromPaste = async () => {
    const parsed = parseEmails(rawText);
    setIsLoading(true);
    try {
      const res = await fetch(apiPaths.courseLookupUsers(courseId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: parsed }),
      });
      if (!res.ok) throw new Error('Lookup failed');
      const data = await res.json();
      // expected: { found: EnrollableUser[], notFound: string[] }
      setFound(data.found ?? []);
      setNotFound(data.notFound ?? []);
      setStep(2);
    } catch (err) {
      alert((err as Error).message || 'Lookup error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnroll = async () => {
    if (found.length === 0) return;
    setIsEnrolling(true);
    try {
      const res = await fetch(apiPaths.courseRosterBulk(courseId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: found.map((u) => u.id) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || 'Enroll failed');
      }
      setStep(3);
      onComplete?.();
    } catch (err) {
      alert((err as Error).message || 'Enroll error');
    } finally {
      setIsEnrolling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="bg-card max-w-3xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Bulk Enroll Students</DialogTitle>
          <DialogDescription>
            Step {step} of 3 —{' '}
            {step === 1 ? 'Paste emails' : step === 2 ? 'Review matches' : 'Done'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {step === 1 && (
            <div>
              <Label htmlFor="emails">Paste emails (one per line or comma-separated)</Label>
              <Textarea
                id="emails"
                className="mt-2 h-64"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
              <div className="text-muted-foreground mt-2 text-sm">
                Note: This tool can only enroll users who already have a system account. If an email
                is not associated with an existing account it will be listed as not found and will
                not be enrolled — ask the student to create an account or add them manually. Lookups
                are case-insensitive, so Email and email@example.com will match the same account.
              </div>
              {/* Controls are in the dialog footer to avoid duplication */}
            </div>
          )}

          {step === 2 && (
            <div className="grid grid-cols-2 gap-4">
              <div className="h-96 overflow-auto rounded border p-2" ref={listRef}>
                <div className="mb-2 font-medium">Matched users ({found.length})</div>
                {found.length === 0 ? (
                  <div className="text-muted-foreground text-sm">No matched users.</div>
                ) : (
                  <ul className="space-y-2">
                    {found.map((u) => (
                      <li key={u.id} className="flex items-center gap-2">
                        <div>
                          <div className="text-sm">
                            {u.firstName} {u.lastName}
                          </div>
                          <div className="text-muted-foreground text-xs">{u.email}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="h-96 overflow-auto rounded border p-2">
                <div className="mb-2 font-medium">Not found ({notFound.length})</div>
                <div className="text-muted-foreground mb-2 text-xs">
                  These emails were not matched to existing system accounts and will not be enrolled
                  automatically. Lookups are case-insensitive.
                </div>
                {notFound.length === 0 ? (
                  <div className="text-muted-foreground text-sm">
                    All emails matched existing accounts.
                  </div>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {notFound.map((e) => (
                      <li key={e} className="bg-muted/10 rounded px-2 py-1">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="p-4">
              <div className="text-lg font-medium">Enrollment complete</div>
              <div className="text-muted-foreground mt-2 text-sm">
                {found.length} users were enrolled. {notFound.length} emails were not found.
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>

          {step === 1 && (
            <Button
              onClick={handleNextFromPaste}
              disabled={isLoading || !rawText.trim() || courseIsArchived}
            >
              Next
            </Button>
          )}

          {step === 2 && (
            <>
              <Button variant="default" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={handleEnroll} disabled={isEnrolling || found.length === 0}>
                {isEnrolling ? 'Enrolling…' : 'Enroll'}
              </Button>
            </>
          )}

          {step === 3 && <Button onClick={() => setOpen(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
