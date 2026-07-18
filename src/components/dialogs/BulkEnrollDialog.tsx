'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
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
import { Stepper } from '@/components/ui/stepper';
import { showToast } from '@/lib/toast';
import type { EnrollableUser } from '@/types/course';
import { apiPaths } from '@/lib/api-paths';
import { BulkEnrollEmailsSchema, BulkEnrollUserIdsSchema } from '@/schemas/bulk';

type Props = {
  open: boolean;
  setOpen: (v: boolean) => void;
  courseId: string;
  courseIsArchived: boolean;
  // callback after enrollments complete
  onComplete?: () => void;
};

// Wizard steps (0-based to match the shared Stepper). "Enroll" happens on the Review
// step; the final step is a read-only result summary.
const STEPS = ['Emails', 'Review', 'Done'] as const;

export default function BulkEnrollDialog({
  open,
  setOpen,
  courseId,
  courseIsArchived,
  onComplete,
}: Props) {
  const [step, setStep] = useState(0);
  const [rawText, setRawText] = useState('');
  const [found, setFound] = useState<EnrollableUser[]>([]);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isEnrolling, setIsEnrolling] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep(0);
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
        body: JSON.stringify(BulkEnrollEmailsSchema.parse({ emails: parsed })),
      });
      if (!res.ok) throw new Error('Could not look up those emails. Please try again.');
      const data = await res.json();
      // expected: { found: EnrollableUser[], notFound: string[] }
      setFound(data.found ?? []);
      setNotFound(data.notFound ?? []);
      setStep(1);
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Lookup failed.');
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
        body: JSON.stringify(BulkEnrollUserIdsSchema.parse({ userIds: found.map((u) => u.id) })),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || 'Could not enroll the selected users. Please try again.');
      }
      showToast.success(`Enrolled ${found.length} student${found.length === 1 ? '' : 's'}.`);
      setStep(2);
      onComplete?.();
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Enroll failed.');
    } finally {
      setIsEnrolling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-card sm:max-w-3xl" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Bulk Enroll Students</DialogTitle>
          <DialogDescription className="sr-only">
            Enroll students in three steps: paste their emails, review the matched accounts, then
            confirm.
          </DialogDescription>
        </DialogHeader>

        <Stepper steps={STEPS} current={step} className="mb-2" />

        {/* Stable min-height so the dialog doesn't resize between steps. */}
        <div className="min-h-[320px] space-y-4" aria-busy={isLoading || isEnrolling}>
          {step === 0 && (
            <div className="space-y-2">
              <Label htmlFor="bulk-enroll-emails">
                Paste emails (one per line or comma-separated)
              </Label>
              <Textarea
                id="bulk-enroll-emails"
                aria-describedby="bulk-enroll-help"
                className="h-64"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
              <p id="bulk-enroll-help" className="text-muted-foreground text-sm">
                This tool can only enroll users who already have a system account. Any email without
                a matching account is listed as not found and is not enrolled; ask that student to
                create an account or add them manually. Lookups are case-insensitive, so Email and
                email@example.com match the same account.
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4 md:grid-cols-2">
              <section
                className="h-96 overflow-auto rounded-md border p-3"
                aria-label="Matched users"
              >
                <h3 className="mb-2 font-medium">Matched users ({found.length})</h3>
                {found.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No matched users.</p>
                ) : (
                  <ul className="space-y-2">
                    {found.map((u) => (
                      <li key={u.id}>
                        <div className="text-sm">
                          {u.firstName} {u.lastName}
                        </div>
                        <div className="text-muted-foreground text-xs break-all">{u.email}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="h-96 overflow-auto rounded-md border p-3" aria-label="Not found">
                <h3 className="mb-2 font-medium">Not found ({notFound.length})</h3>
                <p className="text-muted-foreground mb-2 text-xs">
                  These emails were not matched to existing system accounts and will not be enrolled
                  automatically. Lookups are case-insensitive.
                </p>
                {notFound.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    All emails matched existing accounts.
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {notFound.map((e) => (
                      <li key={e} className="bg-muted/10 rounded px-2 py-1 break-all">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {step === 2 && (
            <div role="status" className="space-y-2 py-4">
              <p className="text-lg font-medium">Enrollment complete</p>
              <p className="text-muted-foreground text-sm">
                {found.length} student{found.length === 1 ? '' : 's'} enrolled. {notFound.length}{' '}
                email{notFound.length === 1 ? '' : 's'} not found.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          {step < 2 && (
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
          )}

          {step === 1 && (
            <Button type="button" variant="secondary" onClick={() => setStep(0)}>
              Back
            </Button>
          )}

          {step === 0 && (
            <Button
              type="button"
              onClick={() => void handleNextFromPaste()}
              disabled={isLoading || !rawText.trim() || courseIsArchived}
            >
              {isLoading ? 'Checking…' : 'Next'}
            </Button>
          )}

          {step === 1 && (
            <Button
              type="button"
              onClick={() => void handleEnroll()}
              disabled={isEnrolling || found.length === 0}
            >
              {isEnrolling ? 'Enrolling…' : `Enroll ${found.length || ''}`.trim()}
            </Button>
          )}

          {step === 2 && (
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
