'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { SettingsSection } from '@/components/settings/settings-layout';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { AssignmentLmsLink } from '@/lib/lti/fetch-assignment-links';

export type { AssignmentLmsLink };

/**
 * Where this assignment appears in an LMS, and the only way to take that record back.
 *
 * The removal is bookkeeping, not an action in the LMS, and the wording says so twice: once in
 * the card and once in the confirmation. Somebody who reads "remove" as "delete it from Canvas"
 * and does not check would otherwise leave a live link nobody is watching.
 *
 * On wording: an assignment link is not the same thing as the course's LMS connection, and this
 * card knows only about the first. It never says whether the AFCT course is connected, because
 * it has not asked; `GradeSyncCard` is the one that reports that. Where a row knows which
 * platform it came from, it uses the name, because "open it once from Canvas" is an instruction
 * and "open it there once" is a riddle.
 */
export function AssignmentLmsLinksCard({
  courseId,
  assignmentId,
  links,
  loading,
  failed,
  courseIsArchived,
  onRemoved,
  onRetry,
}: {
  courseId: string;
  assignmentId: string;
  links: AssignmentLmsLink[];
  loading: boolean;
  /** The list could not be read. Saying nothing was added would be a guess, not an answer. */
  failed?: boolean;
  courseIsArchived?: boolean;
  onRemoved: (linkId: string) => void;
  onRetry?: () => void;
}) {
  const { timezone, hour12 } = useEffectiveTimezone();
  const [toRemove, setToRemove] = useState<AssignmentLmsLink | null>(null);
  /**
   * Where focus goes once a link is removed.
   *
   * Radix restores focus to whatever opened the dialog, and that was the Remove button inside
   * the row the removal has just deleted. Restoring to a node that no longer exists drops focus
   * to the document body, so a keyboard user was returned to the top of the page.
   *
   * The panel's own heading is the anchor; `headingRef` is what makes it focusable. It used to
   * be a CardTitle, which is a div, so this is also the first time the card names itself with a
   * real heading.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);

  const remove = async (link: AssignmentLmsLink) => {
    try {
      const res = await fetch(apiPaths.assignmentLmsLinks(courseId, assignmentId, link.id), {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      onRemoved(link.id);
      showToast.success('Link removed');
    } catch {
      showToast.error('Could not remove the link. Try again.');
    } finally {
      setToRemove(null);
    }
  };

  return (
    // "LMS assignment links", not "In your LMS": it names what the card lists, and it stays
    // true of a link the platform has not confirmed, which "in" would overclaim.
    <SettingsSection title="LMS assignment links" headingLevel={3} headingRef={headingRef}>
      <div className="space-y-4 text-sm">
        {/* One region for the whole card, kept across every branch below, so the wait and
            its outcome are both announced. "Loading…" used to be plain text. */}
        <span role="status" aria-live="polite" className="sr-only">
          {/* Deliberately not a copy of the visible wording below: a screen reader would then
              read the same sentence twice, once announced and once in the page. Short enough
              to be the answer, and different enough not to be an echo. */}
          {loading
            ? 'Checking LMS assignment links.'
            : failed
              ? ''
              : links.length === 0
                ? 'No LMS assignment links found.'
                : `Linked from ${links.length} LMS ${links.length === 1 ? 'course' : 'courses'}.`}
        </span>

        {loading ? (
          <p className="text-muted-foreground" aria-hidden="true">
            Loading…
          </p>
        ) : failed ? (
          <div className="space-y-2">
            {/* A failed read is not an empty answer, and the second sentence is the whole reason
                this state exists: somebody who reads a 500 as "no links" adds a second one, and
                two links to one assignment give the gradebook two columns that disagree. */}
            <p role="alert" className="text-status-danger">
              AFCT could not check this assignment&apos;s LMS links. Existing links may still be
              working, so try again before adding another one.
            </p>
            {onRetry ? (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : links.length === 0 ? (
          /* The workflow named plainly. Links are made in the LMS, not here: the LMS asks which
             AFCT assignment the link should open, and AFCT records the answer. Kept
             platform-neutral, because where AFCT is added varies by product and not every
             platform offers the picker at all. */
          <p className="text-muted-foreground">
            This assignment is not linked from an LMS course yet. To add it, add an AFCT link in
            your LMS course, usually as an assignment or a module item, and choose this assignment
            when AFCT asks which one the link should open.
          </p>
        ) : (
          <>
            <ul className="divide-y">
              {links.map((link) => (
                <li key={link.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium [overflow-wrap:anywhere]">
                      {link.context ? `${link.context} in ${link.platform}` : link.platform}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Added {formatDateTimeInTimeZone(link.addedAt, timezone, hour12)}
                      {link.addedBy ? ` by ${link.addedBy}` : ''}
                    </p>
                    {/* Plain text inside the row rather than a badge beside it, so a screen
                        reader hears it as part of the link it is about. */}
                    {link.confirmedAt ? null : (
                      <p className="text-muted-foreground text-xs">
                        Not opened from {link.platform} yet, so AFCT cannot confirm the link was set
                        up. Open it once from {link.platform} to confirm it.
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={courseIsArchived}
                    onClick={() => setToRemove(link)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            {/* The distinction this card exists to protect: Remove is AFCT's bookkeeping, not
                an action in the LMS. Stated as two separate sentences rather than one qualified
                one, because the second half of a long sentence is what gets skimmed. */}
            <p className="text-muted-foreground text-xs">
              Removing a link here only removes AFCT&apos;s record of it, which is what lets you add
              the assignment again. It does not delete the link from the LMS course: delete that
              separately if you no longer want students to use it. For a link that has not been
              opened yet, check the LMS course first, since it is usually there and simply
              unvisited.
            </p>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!toRemove}
        variant="destructive"
        title="Remove this LMS link?"
        // The consequence first, then the reassurance. The old wording opened with "AFCT stops
        // treating this assignment as already added to", which is what the code does rather
        // than what the reader gets.
        description={
          toRemove
            ? `AFCT will forget that this assignment is linked to ${
                toRemove.context ? `${toRemove.context} in ${toRemove.platform}` : toRemove.platform
              }. The link there will not be deleted and may go on opening this assignment. You can link the assignment again afterwards.`
            : undefined
        }
        confirmText="Remove link"
        onConfirm={() => (toRemove ? remove(toRemove) : undefined)}
        onCancel={() => setToRemove(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          headingRef.current?.focus();
        }}
      />
    </SettingsSection>
  );
}
