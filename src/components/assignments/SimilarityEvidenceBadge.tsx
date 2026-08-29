'use client';

import {
  Binary,
  Fingerprint,
  GitBranch,
  ScanSearch,
  Users,
  BookCheck,
  History,
  Share2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DISPLAY_LABEL,
  DISPLAY_STRENGTH_OF,
  STRENGTH_LABEL,
  type DisplayMatchType,
} from '@/lib/similarity/evidence';

/**
 * How strong the artifact evidence is, and what kind it is.
 *
 * Strength describes the files, never the students: "very strong" means these two artifacts
 * are as alike as artifacts get, not that anybody did anything. The words carry that on
 * their own, because colour cannot: the strength and the kind are both written out, the icon
 * only reinforces them, and the accent is a border rather than a fill so nothing on the page
 * reads as an alarm.
 */

export const MATCH_ICON: Record<DisplayMatchType, LucideIcon> = {
  // The raw file rather than what was read out of it, which is the whole distinction between
  // this kind and the one below it.
  'byte-identical': Binary,
  exact: Fingerprint,
  'same-machine': GitBranch,
  structural: ScanSearch,
  reference: BookCheck,
  common: Users,
};

/** Badge tint per kind. Deliberately not a traffic light: green never appears here. */
const BADGE_VARIANT: Record<DisplayMatchType, 'danger' | 'warning' | 'info' | 'neutral'> = {
  // The same tint as an exact artifact on purpose. It is a sharper statement of the same
  // finding, and the difference between them belongs in the words, not in a new colour.
  'byte-identical': 'danger',
  exact: 'danger',
  'same-machine': 'warning',
  structural: 'info',
  reference: 'neutral',
  common: 'neutral',
};

/**
 * The whole edge of a card, echoing the badge for people scanning rather than reading.
 *
 * All four sides rather than the left one alone: a card can be tall enough that its badge
 * and its accent are both off the top of the screen while the reader is halfway down it, and
 * a framed card says what kind it is wherever they happen to be looking. Two pixels, in the
 * badge's own border colour, so it frames the card without becoming the loudest thing on the
 * page. It supplies the card's ONLY border: `border` as well would set the width twice.
 */
export const ACCENT_BORDER: Record<DisplayMatchType, string> = {
  'byte-identical': 'border-2 border-badge-danger-border',
  exact: 'border-2 border-badge-danger-border',
  'same-machine': 'border-2 border-badge-warning-border',
  structural: 'border-2 border-badge-info-border',
  reference: 'border-2 border-badge-neutral-border',
  common: 'border-2 border-badge-neutral-border',
};

export function SimilarityEvidenceBadge({ type }: { type: DisplayMatchType }) {
  const Icon = MATCH_ICON[type];
  const strength = DISPLAY_STRENGTH_OF[type];

  return (
    <Badge variant={BADGE_VARIANT[type]} className="gap-1.5">
      <Icon className="size-3.5" aria-hidden="true" />
      {/* A kind that carries no strength says only what it is. Writing "Expected" in front
          of it would put a word from the evidence scale on a card that is not on it. */}
      {strength === 'none' ? (
        DISPLAY_LABEL[type]
      ) : (
        <>
          <span className="font-semibold uppercase">{STRENGTH_LABEL[strength]}</span>
          <span aria-hidden="true">·</span>
          {DISPLAY_LABEL[type]}
        </>
      )}
    </Badge>
  );
}

/**
 * A group of more than one kind of relationship, labelled by what it is rather than by its
 * strongest part.
 *
 * "Very strong · Exact JFLAP artifact" over four students is a claim about all four, and in a
 * group held together by a shared student it is true of two of them. The kinds are listed
 * under the heading and each relationship carries its own badge, so nothing is lost by the
 * card itself staying neutral.
 */
export function RelatedSubmissionsBadge({ count }: { count: number }) {
  return (
    <Badge variant="neutral" className="gap-1.5">
      <Share2 className="size-3.5" aria-hidden="true" />
      {count} similarity relationship{count === 1 ? '' : 's'}
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
