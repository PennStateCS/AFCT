'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RosterSyncDialog } from '@/components/course/RosterSyncDialog';

/**
 * "Sync roster from your LMS", wherever a roster is being looked at.
 *
 * It asks first whether the course is connected to an LMS, and renders nothing when it is not:
 * a button that can only ever say "this course has no LMS" is worse than no button. That check
 * is why this is its own component rather than two copies of a `<Button>`, and why the caller
 * does not have to know anything about LTI.
 */
export function RosterSyncButton({
  courseId,
  onSynced,
  className,
}: {
  courseId: string;
  /** Called after changes are applied, so the roster on screen can be refetched. */
  onSynced?: () => void;
  className?: string;
}) {
  const [linked, setLinked] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/courses/${courseId}/lti-link`);
        if (!res.ok) return;
        const { links } = (await res.json()) as { links?: unknown[] };
        if (!cancelled) setLinked(Array.isArray(links) && links.length > 0);
      } catch {
        // No LMS shown is the safe answer: the button appears on the next load.
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (!linked) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className={className}>
        <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" />
        Sync roster
      </Button>
      <RosterSyncDialog
        courseId={courseId}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Applying rewrites the roster underneath the table, so it is refetched on close
          // rather than left showing who was enrolled a minute ago.
          if (!next) onSynced?.();
        }}
      />
    </>
  );
}
