'use client';

import { Button } from '@/components/ui/button';
import { MATCH_ICON } from './SimilarityEvidenceBadge';
import { MATCH_LABEL, type MatchType } from '@/lib/similarity/evidence';

export type MatchFilter = MatchType | 'all';

/**
 * The kinds worth reviewing, and nothing else.
 *
 * Common answers and the instructor's own solution are not filters: they are set aside at
 * the foot of the page, with their own count and their own control. A button that claimed to
 * narrow the page to them and then left the review list where it was is worse than no button.
 */
const ORDER: MatchFilter[] = ['all', 'exact', 'same-machine', 'structural'];

/**
 * Shorter than the card labels, and only where the short form still says the same thing.
 *
 * "Exact artifact" for "Exact JFLAP artifact": the file format is on every card already and
 * a filter row is read at a glance. Nothing here changes what a kind means, and the full
 * label stays on the card and in the popover that explains it.
 */
const LABEL: Record<MatchFilter, string> = {
  all: 'All',
  exact: 'Exact artifact',
  'same-machine': MATCH_LABEL['same-machine'],
  structural: MATCH_LABEL.structural,
  reference: MATCH_LABEL.reference,
  common: MATCH_LABEL.common,
  // Present for the type, never rendered: see ORDER above.
};

/**
 * Narrow a long page to one kind of match.
 *
 * A course of a few hundred can produce more groups than anybody reads in one sitting, and
 * the first question is usually "show me the exact ones". A row of buttons rather than a
 * control panel: this is a review page, not a dashboard.
 */
export function SimilarityFilters({
  counts,
  value,
  onChange,
}: {
  counts: Record<MatchFilter, number>;
  value: MatchFilter;
  onChange: (next: MatchFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter matches">
      {ORDER.filter((filter) => filter === 'all' || counts[filter] > 0).map((filter) => {
        const Icon = filter === 'all' ? null : MATCH_ICON[filter];
        const selected = value === filter;
        return (
          <Button
            key={filter}
            type="button"
            size="sm"
            // Outline rather than ghost when unselected, so the row reads as a set of
            // choices rather than as loose text, and the selected one is unmistakably filled.
            variant={selected ? 'secondary' : 'outline'}
            // The selected state has to be announced, not just shaded.
            aria-pressed={selected}
            onClick={() => onChange(filter)}
          >
            {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
            {LABEL[filter]}
            {/* Quieter than the label only when the button is unselected. On the filled
                selected button, muted grey sits on a dark background and stops being
                readable, so the count takes the button's own foreground colour. */}
            <span
              className={`rounded px-1 tabular-nums ${
                selected ? 'bg-secondary-foreground/10' : 'text-muted-foreground bg-muted'
              }`}
            >
              {counts[filter]}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
