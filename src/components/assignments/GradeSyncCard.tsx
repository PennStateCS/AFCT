'use client';

import { useCallback, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
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
 * Whether this assignment's grades are reaching the LMS.
 *
 * Only appears when the course is linked to one. Says what happened in words rather than a
 * colour, because "did my grades arrive" must be answerable by anyone.
 */
export function GradeSyncCard({ assignmentId }: { assignmentId: string }) {
  const { timezone, hour12 } = useEffectiveTimezone();
  const [state, setState] = useState<SyncState | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!state?.linked) return null;

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
      showToast.error('Could not change that. Try again.');
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
      showToast.error('Could not send those grades. Try again.');
    } finally {
      setBusy(false);
    }
  };

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

      <SwitchField
        name="ltiAutoSync"
        label="Send grades automatically"
        description="Grades go to your LMS as you award and change them."
        checked={state.autoSync}
        onCheckedChange={(value) => void setAuto(value)}
        descriptionPlacement="inline"
      />

      <Button variant="outline" size="sm" onClick={() => void sendNow()} disabled={busy}>
        <Send className="mr-2 h-4 w-4" aria-hidden="true" />
        {busy ? 'Sending...' : 'Send grades now'}
      </Button>
    </div>
  );
}
