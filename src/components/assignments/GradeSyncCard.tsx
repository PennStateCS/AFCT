'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronUp, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SwitchField from '@/components/ui/SwitchField';
import { SettingsSection } from '@/components/settings/settings-layout';
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
  /** The open student's own grade, when one was asked about. */
  student: {
    state: 'PENDING' | 'SENT' | 'FAILED';
    sentAt: string | null;
    lastError: string | null;
  } | null;
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
  studentId,
}: {
  assignmentId: string;
  variant: 'settings' | 'status' | 'inline';
  /**
   * Whose work is on screen. The inline panel reports and sends this student's grade alone,
   * because a button sitting beside one person's grade must not deliver the whole class's.
   */
  studentId?: string | null;
}) {
  const { timezone, hour12 } = useEffectiveTimezone();
  const [state, setState] = useState<SyncState | null>(null);
  const [busy, setBusy] = useState<'student' | 'all' | null>(null);
  const [open, setOpen] = useState(true);

  const scoped = variant === 'inline' && !!studentId;

  const load = useCallback(async () => {
    try {
      const url = new URL(`/api/assignments/${assignmentId}/lti-sync`, window.location.origin);
      if (variant === 'inline' && studentId) url.searchParams.set('userId', studentId);
      const res = await fetch(url.pathname + url.search);
      if (!res.ok) throw new Error();
      setState((await res.json()) as SyncState);
    } catch {
      setState(null);
    }
  }, [assignmentId, studentId, variant]);

  useEffect(() => {
    void load();
  }, [load]);

  /** What the panel says about the assignment as a whole. */
  const assignmentText = !state?.linked
    ? ''
    : state.failed > 0
      ? `${state.failed} ${state.failed === 1 ? 'grade' : 'grades'} could not be sent to your LMS.`
      : state.pending > 0
        ? `${state.pending} ${state.pending === 1 ? 'grade is' : 'grades are'} waiting to be sent to your LMS.`
        : state.sent > 0
          ? 'All grades for this assignment have been sent to your LMS.'
          : 'No grades have been sent to your LMS yet.';

  /**
   * What it says about the student on screen.
   *
   * A failure quotes the reason rather than a count, because the reason is the whole of what a
   * person can act on: "your LMS does not list this student" and "your LMS refused the grade"
   * need completely different things done about them.
   */
  const studentText = !state?.linked
    ? ''
    : !state.student
      ? 'This grade has not been sent to your LMS.'
      : state.student.state === 'FAILED'
        ? (state.student.lastError ?? 'This grade could not be sent to your LMS.')
        : state.student.state === 'PENDING'
          ? 'This grade is waiting to be sent to your LMS.'
          : 'This grade has been sent to your LMS.';

  /** Everyone else's grades that still need attention, so a failure elsewhere is not hidden. */
  const othersOutstanding =
    state && scoped
      ? Math.max(
          0,
          state.pending + state.failed - (state.student && state.student.state !== 'SENT' ? 1 : 0),
        )
      : 0;

  if (!state?.linked) {
    // The Settings tab is a real destination, so it explains itself rather than being blank.
    // The Submissions tab is not: nothing to say there when no LMS is involved.
    return variant === 'settings' ? (
      <SettingsSection title="Grades in your LMS" headingLevel={3}>
        <p className="text-muted-foreground text-sm">
          This course is not connected to an LMS, so there are no grade settings to change. Once
          somebody opens AFCT from your LMS and connects the course, this is where you choose
          whether grades are sent automatically.
        </p>
      </SettingsSection>
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

  /**
   * Send one student's grade, or every outstanding one.
   *
   * `only` is the whole difference: the route sends the assignment's grades unless it is given a
   * student, so passing the wrong thing here quietly delivers the class.
   */
  const sendNow = async (only: string | null) => {
    setBusy(only ? 'student' : 'all');
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/lti-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(only ? { userId: only } : {}),
      });
      if (!res.ok) throw new Error();
      const { queued } = (await res.json()) as { queued: number };
      showToast.success(
        only
          ? queued === 0
            ? 'This grade is already up to date in your LMS.'
            : 'This grade is on its way to your LMS.'
          : queued === 0
            ? 'Every grade is already up to date in your LMS.'
            : `${queued} ${queued === 1 ? 'grade is' : 'grades are'} on their way to your LMS.`,
      );
      await load();
    } catch {
      showToast.error('Could not send those grades. Check your connection and try again.');
    } finally {
      setBusy(null);
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
        {/*
          Rendered whether or not it is open, and hidden with the `hidden` attribute.
          `aria-controls` above pointed at an id that only existed while the panel was open, so
          collapsing it left a dangling reference. Keeping it mounted also keeps the live region
          inside alive, so a grade sent while the panel is collapsed is still announced.
        */}
        <div id="lms-sync" hidden={!open} className="flex flex-col gap-2">
          {/* One live region for this panel, so a send is announced once. */}
          <p className="text-muted-foreground text-xs" role="status">
            {scoped ? studentText : assignmentText}
          </p>
          {(scoped ? state.student?.sentAt : state.lastSentAt) && (
            <p className="text-muted-foreground text-xs">
              Last sent{' '}
              {formatDateTimeInTimeZone(
                (scoped ? state.student?.sentAt : state.lastSentAt) as string,
                timezone,
                hour12,
              )}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => void sendNow(scoped ? (studentId as string) : null)}
            disabled={busy !== null}
          >
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            {busy === 'student' || (busy === 'all' && !scoped)
              ? 'Sending...'
              : scoped
                ? 'Send this grade now'
                : 'Send grades now'}
          </Button>

          {/* The rest of the class, which the button above deliberately leaves alone. Shown
                only when there is something to do, so the usual case stays one line and one
                button. */}
          {othersOutstanding > 0 && (
            <div className="mt-1 flex flex-col gap-2 border-t pt-2">
              <p className="text-muted-foreground text-xs">
                {othersOutstanding} other {othersOutstanding === 1 ? 'grade' : 'grades'} on this
                assignment {othersOutstanding === 1 ? 'is' : 'are'} waiting or failed.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => void sendNow(null)}
                disabled={busy !== null}
              >
                {busy === 'all' ? 'Sending...' : 'Send all outstanding grades'}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (variant === 'settings') {
    return (
      // The settings panel the rest of this tab uses. It was a bare rounded-md box with a
      // text-sm heading, which put a major section at the weight of a field label.
      <SettingsSection title="Grades in your LMS" headingLevel={3}>
        <SwitchField
          name="ltiAutoSync"
          label="Send grades automatically"
          description="Grades go to your LMS as you award and change them."
          checked={state.autoSync}
          onCheckedChange={(value) => void setAuto(value)}
          descriptionPlacement="inline"
        />
      </SettingsSection>
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

      <Button
        variant="outline"
        size="sm"
        onClick={() => void sendNow(null)}
        disabled={busy !== null}
      >
        <Send className="mr-2 h-4 w-4" aria-hidden="true" />
        {busy ? 'Sending...' : 'Send grades now'}
      </Button>
    </div>
  );
}
