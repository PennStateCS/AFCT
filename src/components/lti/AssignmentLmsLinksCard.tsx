'use client';

import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { LmsLinkSummary } from '@/lib/lti/link-labels';

export type AssignmentLmsLink = Omit<LmsLinkSummary, 'addedAt'> & { addedAt: string };

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
  courseIsArchived,
  onRemoved,
}: {
  courseId: string;
  assignmentId: string;
  links: AssignmentLmsLink[];
  loading: boolean;
  courseIsArchived?: boolean;
  onRemoved: (linkId: string) => void;
}) {
  const { timezone, hour12 } = useEffectiveTimezone();
  const [toRemove, setToRemove] = useState<AssignmentLmsLink | null>(null);

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
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4" aria-hidden="true" />
          In your LMS
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : links.length === 0 ? (
          <p className="text-muted-foreground">
            This assignment has not been added to a course in your LMS. Add it from the LMS
            itself, where an AFCT link asks which assignment it should open.
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
      />
    </Card>
  );
}
