import { Info } from 'lucide-react';
import { asLaunchNotice, launchNoticeMessage } from '@/lib/lti/launch-landing';

/**
 * Why a launch landed on the dashboard rather than in a course.
 *
 * Server-rendered from the query string, so it is on screen in the first paint: this is read
 * once, by somebody who has just been sent somewhere they did not click, and a message that
 * arrives after a spinner has already been missed.
 *
 * Renders nothing for an absent or unrecognised reason, so an invented query parameter cannot
 * put a sentence on somebody's dashboard. The course title is the LMS's own text and is placed
 * as text, never as markup.
 */
export function LaunchNotice({
  notice,
  courseTitle,
}: {
  notice?: string | null;
  courseTitle?: string | null;
}) {
  const known = asLaunchNotice(notice);
  if (!known) return null;

  return (
    <div
      role="status"
      className="border-status-info-border bg-status-info-bg text-status-info mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{launchNoticeMessage(known, courseTitle?.trim() || null)}</p>
    </div>
  );
}
