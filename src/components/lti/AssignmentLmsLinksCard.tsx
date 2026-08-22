'use client';

import { useRef, useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
   */
  const headingRef = useRef<HTMLDivElement>(null);

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
    <Card>
      <CardHeader>
        <CardTitle ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" aria-hidden="true" />
          In your LMS
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* One region for the whole card, kept across every branch below, so the wait and
            its outcome are both announced. "Loading…" used to be plain text. */}
        <span role="status" aria-live="polite" className="sr-only">
          {/* Deliberately not a copy of the visible wording below: a screen reader would then
              read the same sentence twice, once announced and once in the page. Short enough
              to be the answer, and different enough not to be an echo. */}
          {loading
            ? 'Checking your LMS.'
            : failed
              ? ''
              : links.length === 0
                ? 'No LMS links.'
                : `In ${links.length} LMS ${links.length === 1 ? 'course' : 'courses'}.`}
        </span>

        {loading ? (
          <p className="text-muted-foreground" aria-hidden="true">
            Loading…
          </p>
        ) : failed ? (
          <div className="space-y-2">
            <p role="alert" className="text-status-danger">
              AFCT could not check where this assignment appears in your LMS. This does not mean it
              is not there.
            </p>
            {onRetry ? (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : links.length === 0 ? (
          <p className="text-muted-foreground">
            This assignment has not been added to a course in your LMS. Add it from the LMS itself,
            where an AFCT link asks which assignment it should open.
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
                        Nobody has opened this link yet, so AFCT cannot tell whether your LMS kept
                        it. Open it there once to settle it.
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
            <p className="text-muted-foreground text-xs">
              Removing one here only tells AFCT the assignment is no longer in that course, which
              lets you add it again. The link in your LMS keeps working until you delete it there.
              For a link nobody has opened yet, look in your LMS before removing it: it is usually
              there and simply unvisited.
            </p>
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!toRemove}
        variant="destructive"
        title="Remove this LMS link?"
        description={
          toRemove
            ? `AFCT stops treating this assignment as already added to ${
                toRemove.context ? `${toRemove.context} in ${toRemove.platform}` : toRemove.platform
              }, so you can add it again. Nothing changes in your LMS: the existing link there goes on opening this assignment until you delete it yourself.`
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
    </Card>
  );
}
