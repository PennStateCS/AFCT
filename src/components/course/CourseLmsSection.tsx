'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Unlink } from 'lucide-react';
import { RosterSyncDialog } from '@/components/course/RosterSyncDialog';
import { Button } from '@/components/ui/button';
import { SettingsSection } from '@/components/settings/settings-layout';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

type Link = {
  id: string;
  platformName: string;
  contextTitle: string | null;
  contextId: string;
  linkedAt: string;
  canSendGrades: boolean;
  linkedBy: string | null;
};

/**
 * Which LMS courses open this one.
 *
 * Until this existed the link was invisible once made, and could only be changed in the
 * database. Several links is normal: cross-listed sections are separate courses in the LMS.
 *
 * Its own panel in the Settings tab's main column, not a block inside the status card in
 * the rail. Each row carries a title, a platform, a date and a Disconnect button, which is
 * more than a 288px rail holds without truncating all four. The component still decides
 * whether it appears at all, so the panel is never drawn empty.
 */
export function CourseLmsSection({ courseId }: { courseId: string }) {
  const { timezone, hour12 } = useEffectiveTimezone();
  const [links, setLinks] = useState<Link[] | null>(null);
  const [removing, setRemoving] = useState<Link | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}/lti-link`);
      if (!res.ok) throw new Error();
      setLinks(((await res.json()) as { links: Link[] }).links);
    } catch {
      setLinks([]);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const unlink = async () => {
    if (!removing) return;
    try {
      const res = await fetch(`/api/courses/${courseId}/lti-link?linkId=${removing.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      showToast.success('Disconnected from that LMS course');
      setRemoving(null);
      await load();
    } catch {
      showToast.error('Could not disconnect that LMS course. Check your connection and try again.');
    }
  };

  // Nothing to say for a course nobody opens from an LMS.
  if (!links || links.length === 0) return null;

  return (
    <SettingsSection
      title="Connected to your LMS"
      description="People can open this course from here. Grades are sent per assignment, on each assignment's Settings tab."
      headingLevel={3}
    >
      <ul className="divide-y rounded-md border">
        {links.map((link) => (
          <li key={link.id} className="flex items-start justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {link.contextTitle ?? `Course ${link.contextId}`}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {link.platformName}
                {link.linkedBy ? `, connected by ${link.linkedBy}` : ''}
                {' on '}
                {formatDateTimeInTimeZone(link.linkedAt, timezone, hour12)}
              </p>
              {!link.canSendGrades && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Grades cannot be sent yet. Somebody needs to open AFCT from this LMS course once,
                  so it can tell AFCT where its gradebook is.
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => setRemoving(link)}>
              <Unlink className="mr-2 h-4 w-4" aria-hidden="true" />
              Disconnect
            </Button>
          </li>
        ))}
      </ul>

      <Button variant="outline" size="sm" onClick={() => setSyncing(true)}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
        Sync roster from your LMS
      </Button>

      <RosterSyncDialog courseId={courseId} open={syncing} onOpenChange={setSyncing} />

      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        title="Disconnect this LMS course?"
        description="Nobody will be able to open this course from your LMS, and grades will stop being sent. Grades already in your LMS stay there, and the course can be connected again."
        confirmText="Disconnect"
        variant="destructive"
        onConfirm={unlink}
      />
    </SettingsSection>
  );
}
