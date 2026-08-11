'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronUp, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SwitchField from '@/components/ui/SwitchField';
import { showToast } from '@/lib/toast';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

type SyncState = {
  linked: boolean;
  autoSync: boolean;
  pending: number;
  sent: number;
  failed: number;
  lastSentAt: string | null;
};

/**
 * Grade sync for one assignment. Renders nothing unless the course is linked to an LMS.
 *
 * Split across two tabs on purpose: `settings` configures whether grades go, and `status` shows
 * whether they arrived, next to the grades themselves. Configure where you configure things,
 * check where you look at the work.
 */
export function GradeSyncCard({
  assignmentId,
  variant,
}: {
  assignmentId: string;
  variant: 'settings' | 'status' | 'inline';
}) {
  const { timezone, hour12 } = useEffectiveTimezone();
  const [state, setState] = useState<SyncState | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/lti-sync`);
      if (!res.ok) throw new Error();
      setState((await res.json()) as SyncState);
    } catch {
      setState(null);
    }
  }, [assignmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusText = !state?.linked
    ? ''
    : state.failed > 0
      ? `${state.failed} ${state.failed === 1 ? 'grade' : 'grades'} could not be sent to your LMS.`
      : state.pending > 0
        ? `${state.pending} ${state.pending === 1 ? 'grade is' : 'grades are'} waiting to be sent to your LMS.`
        : state.sent > 0
          ? 'All grades for this assignment have been sent to your LMS.'
          : 'No grades have been sent to your LMS yet.';

  if (!state?.linked) {
    // The Settings tab is a real destination, so it explains itself rather than being blank.
    // The Submissions tab is not: nothing to say there when no LMS is involved.
    return variant === 'settings' ? (
      <p className="text-muted-foreground max-w-2xl text-sm">
        This course is not connected to an LMS, so there are no grade settings to change. Once
        somebody opens AFCT from your LMS and connects the course, this is where you choose whether
        grades are sent automatically.
      </p>
    ) : null;
  }

  const setAuto = async (autoSync: boolean) => {
    setState({ ...state, autoSync });
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/lti-sync`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSync }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setState({ ...state, autoSync: !autoSync });
      showToast.error('Could not change that setting. Check your connection and try again.');
    }
  };

  const sendNow = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/lti-sync`, { method: 'POST' });
      if (!res.ok) throw new Error();
      const { queued } = (await res.json()) as { queued: number };
      showToast.success(
        queued === 0
          ? 'Every grade is already up to date in your LMS.'
          : `${queued} ${queued === 1 ? 'grade is' : 'grades are'} on their way to your LMS.`,
      );
      await load();
    } catch {
      showToast.error('Could not send those grades. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  // A section of the grading panel, styled like the ones around it rather than as its own
  // card. This is the only place the state appears: it belongs next to the grade being given.
  if (variant === 'inline') {
    return (
      // Separated from the grade form above it, the way the panel's other sections are.
      <div className="flex flex-col gap-2 border-t pt-4">
        <div className="flex items-center gap-2">
          <RefreshCw className="text-muted-foreground h-4 w-4" aria-hidden="true" />
          <h3 className="text-sm font-medium">LMS Sync</h3>
          {/* Open by default: whether grades reached the LMS is worth seeing without asking. */}
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls="lms-sync"
            className="text-muted-foreground hover:text-foreground ml-auto rounded p-1"
          >
            <ChevronUp
              className={`h-4 w-4 transition-transform ${open ? '' : 'rotate-180'}`}
              aria-hidden="true"
            />
            <span className="sr-only">{open ? 'Collapse LMS sync' : 'Expand LMS sync'}</span>
          </button>
        </div>
        {open && (
          <div id="lms-sync" className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs" role="status">
              {statusText}
            </p>
            {state.lastSentAt && (
              <p className="text-muted-foreground text-xs">
                Last sent {formatDateTimeInTimeZone(state.lastSentAt, timezone, hour12)}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void sendNow()}
              disabled={busy}
            >
              <Send className="mr-2 h-4 w-4" aria-hidden="true" />
              {busy ? 'Sending...' : 'Send grades now'}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (variant === 'settings') {
    return (
      <div className="max-w-2xl space-y-4 rounded-md border p-4">
        <h2 className="text-sm font-medium">Grades in your LMS</h2>
        <SwitchField
          name="ltiAutoSync"
          label="Send grades automatically"
          description="Grades go to your LMS as you award and change them."
          checked={state.autoSync}
          onCheckedChange={(value) => void setAuto(value)}
          descriptionPlacement="inline"
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4 rounded-md border p-4">
      <div>
        <h2 className="text-sm font-medium">Grades in your LMS</h2>
        <p className="text-muted-foreground mt-1 text-sm" role="status">
          {state.failed > 0
            ? `${state.failed} ${state.failed === 1 ? 'grade' : 'grades'} could not be sent. Open the Submissions tab to see which.`
            : state.pending > 0
              ? `${state.pending} ${state.pending === 1 ? 'grade is' : 'grades are'} waiting to be sent.`
              : state.sent > 0
                ? 'All grades have been sent.'
                : 'No grades have been sent yet.'}
        </p>
        {state.lastSentAt && (
          <p className="text-muted-foreground mt-1 text-xs">
            Last sent {formatDateTimeInTimeZone(state.lastSentAt, timezone, hour12)}
          </p>
        )}
      </div>

      <Button variant="outline" size="sm" onClick={() => void sendNow()} disabled={busy}>
        <Send className="mr-2 h-4 w-4" aria-hidden="true" />
        {busy ? 'Sending...' : 'Send grades now'}
      </Button>
    </div>
  );
}
