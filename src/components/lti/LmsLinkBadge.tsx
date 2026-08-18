import { Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { lmsBadgeLabel, lmsLinkDescription } from '@/lib/lti/link-labels';

/**
 * "In Canvas", on a course or an assignment that an LMS opens.
 *
 * Renders nothing when there are no links, so every caller can place it unconditionally.
 *
 * The badge text is short enough to sit in a header, so the LMS course names go into the
 * accessible name rather than being dropped: a screen reader reaches the same detail a sighted
 * reader gets from the tooltip. The icon is decorative, and the wording carries the meaning on
 * its own, because a link is not a state anyone should have to infer from a colour.
 */
export function LmsLinkBadge({
  links,
  className,
}: {
  links: Array<{ platform: string; context: string | null }>;
  className?: string;
}) {
  const label = lmsBadgeLabel(links);
  if (!label) return null;

  const detail = lmsLinkDescription(links);
  const description = detail.length > 0 ? `${label}: ${detail.join(', ')}` : label;

  return (
    <Badge
      variant="outline"
      className={`bg-status-info-bg border-status-info-border text-status-info shrink-0 gap-1.5 text-xs font-normal ${className ?? ''}`}
      title={description}
      aria-label={description}
    >
      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Badge>
  );
}
