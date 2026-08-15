'use client';

import { Fingerprint, GitBranch, ScanSearch, Users, History } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { MATCH_LABEL, STRENGTH_LABEL, STRENGTH_OF, type MatchType } from '@/lib/similarity/evidence';

/**
 * How strong the artifact evidence is, and what kind it is.
 *
 * Strength describes the files, never the students: "very strong" means these two artifacts
 * are as alike as artifacts get, not that anybody did anything. The words carry that on
 * their own, because colour cannot: the strength and the kind are both written out, the icon
 * only reinforces them, and the accent is a border rather than a fill so nothing on the page
 * reads as an alarm.
 */

export const MATCH_ICON: Record<MatchType, LucideIcon> = {
  exact: Fingerprint,
  'same-machine': GitBranch,
  structural: ScanSearch,
  common: Users,
};

/** Badge tint per kind. Deliberately not a traffic light: green never appears here. */
const BADGE_VARIANT: Record<MatchType, 'danger' | 'warning' | 'info' | 'neutral'> = {
  exact: 'danger',
  'same-machine': 'warning',
  structural: 'info',
  common: 'neutral',
};

/** The left edge of a card, echoing the badge for people scanning rather than reading. */
export const ACCENT_BORDER: Record<MatchType, string> = {
  exact: 'border-l-4 border-l-badge-danger-border',
  'same-machine': 'border-l-4 border-l-badge-warning-border',
  structural: 'border-l-4 border-l-badge-info-border',
  common: 'border-l-4 border-l-badge-neutral-border',
};

export function SimilarityEvidenceBadge({ type }: { type: MatchType }) {
  const Icon = MATCH_ICON[type];
  const strength = STRENGTH_OF[type];

  return (
    <Badge variant={BADGE_VARIANT[type]} className="gap-1.5">
      <Icon className="size-3.5" aria-hidden="true" />
      {type === 'common' ? (
        MATCH_LABEL.common
      ) : (
        <>
          <span className="font-semibold uppercase">{STRENGTH_LABEL[strength]}</span>
          <span aria-hidden="true">·</span>
          {MATCH_LABEL[type]}
        </>
      )}
    </Badge>
  );
}

/**
 * Timing context, and secondary on purpose. It matters, but a weaker artifact match does not
 * become a stronger one because of when it arrived, so it never outranks the kind.
 */
export function ReusedAfterPassBadge() {
  return (
    <Badge variant="outline" className="gap-1.5">
      <History className="size-3.5" aria-hidden="true" />
      Reused after passing
    </Badge>
  );
}
