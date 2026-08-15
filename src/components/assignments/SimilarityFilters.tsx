'use client';

import { Button } from '@/components/ui/button';
import { MATCH_ICON } from './SimilarityEvidenceBadge';
import { MATCH_LABEL, type MatchType } from './similarity-evidence';

export type MatchFilter = MatchType | 'all';

const ORDER: MatchFilter[] = ['all', 'exact', 'same-machine', 'structural', 'common'];

const LABEL: Record<MatchFilter, string> = {
  all: 'All',
  exact: MATCH_LABEL.exact,
  'same-machine': MATCH_LABEL['same-machine'],
  structural: MATCH_LABEL.structural,
  common: MATCH_LABEL.common,
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
            variant={selected ? 'secondary' : 'ghost'}
            // The selected state has to be announced, not just shaded.
            aria-pressed={selected}
            onClick={() => onChange(filter)}
          >
            {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
            {LABEL[filter]}
            <span className="text-muted-foreground tabular-nums">{counts[filter]}</span>
          </Button>
        );
      })}
    </div>
  );
}
