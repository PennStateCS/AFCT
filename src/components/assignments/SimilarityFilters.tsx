'use client';

import { Button } from '@/components/ui/button';
import { MATCH_ICON } from './SimilarityEvidenceBadge';
import { MATCH_LABEL, type DisplayMatchType } from '@/lib/similarity/evidence';

export type MatchFilter = DisplayMatchType | 'all';

/**
 * The kinds worth reviewing, and nothing else.
 *
 * Common answers and the instructor's own solution are not filters: they are set aside at
 * the foot of the page, with their own count and their own control. A button that claimed to
 * narrow the page to them and then left the review list where it was is worse than no button.
 */
const ORDER: MatchFilter[] = ['all', 'byte-identical', 'exact', 'same-machine', 'structural'];

/**
 * Shorter than the card labels, and only where the short form still says the same thing.
 *
 * "Exact artifact" for "Exact JFLAP artifact": the file format is on every card already and
 * a filter row is read at a glance. Nothing here changes what a kind means, and the full
 * label stays on the card and in the popover that explains it.
 */
const LABEL: Record<MatchFilter, string> = {
  all: 'All',
  'byte-identical': 'Byte-for-byte',
  exact: 'Exact artifact',
  'same-machine': MATCH_LABEL['same-machine'],
  structural: MATCH_LABEL.structural,
  reference: MATCH_LABEL.reference,
  common: MATCH_LABEL.common,
  // Present for the type, never rendered: see ORDER above.
};

/**
 * The same colours the cards carry, so a button and the cards it shows are one thing.
 *
 * The kinds are already coloured on every card and on the left edge of each one; a filter
 * row in plain grey made the reader translate between two systems. Selection is a tint plus
 * a ring rather than a different colour, because a selected byte-for-byte button that turned
 * grey would be the one place the colour stopped meaning what it means everywhere else.
 *
 * Written out per state rather than composed, so every class is visible to the stylesheet
 * and to whoever reads this next.
 */
const TINT: Record<MatchFilter, { on: string; off: string }> = {
  all: {
    on: 'border-badge-neutral-border bg-badge-neutral-bg text-badge-neutral ring-2 ring-badge-neutral-border',
    off: 'border-badge-neutral-border text-badge-neutral hover:bg-badge-neutral-bg',
  },
  'byte-identical': {
    on: 'border-badge-danger-border bg-badge-danger-bg text-badge-danger ring-2 ring-badge-danger-border',
    off: 'border-badge-danger-border text-badge-danger hover:bg-badge-danger-bg',
  },
  exact: {
    on: 'border-badge-danger-border bg-badge-danger-bg text-badge-danger ring-2 ring-badge-danger-border',
    off: 'border-badge-danger-border text-badge-danger hover:bg-badge-danger-bg',
  },
  'same-machine': {
    on: 'border-badge-warning-border bg-badge-warning-bg text-badge-warning ring-2 ring-badge-warning-border',
    off: 'border-badge-warning-border text-badge-warning hover:bg-badge-warning-bg',
  },
  structural: {
    on: 'border-badge-info-border bg-badge-info-bg text-badge-info ring-2 ring-badge-info-border',
    off: 'border-badge-info-border text-badge-info hover:bg-badge-info-bg',
  },
  // Present for the type, never rendered: see ORDER above.
  reference: {
    on: 'border-badge-neutral-border bg-badge-neutral-bg text-badge-neutral',
    off: 'border-badge-neutral-border text-badge-neutral',
  },
  common: {
    on: 'border-badge-neutral-border bg-badge-neutral-bg text-badge-neutral',
    off: 'border-badge-neutral-border text-badge-neutral',
  },
};

/**
 * Narrow a long page to one kind of match.
 *
 * A course of a few hundred can produce more groups than anybody reads in one sitting, and
 * the first question is usually "show me the exact ones". A row of buttons rather than a
 * control panel: this is a review page, not a dashboard.
 *
 * Every kind is shown, including the ones this assignment has none of. A zero is an answer:
 * it says AFCT looked for that kind and did not find it, which the reader cannot know from
 * an absent button. They stay ordinary buttons rather than disabled ones, so choosing one
 * gives a sentence saying so rather than nothing happening.
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
      {ORDER.map((filter) => {
        const Icon = filter === 'all' ? null : MATCH_ICON[filter];
        const selected = value === filter;
        return (
          <Button
            key={filter}
            type="button"
            size="sm"
            // Outlined rather than ghost, so the row reads as a set of choices rather than as
            // loose text, and the chosen one carries a ring as well as a fill.
            variant="outline"
            className={selected ? `font-semibold ${TINT[filter].on}` : TINT[filter].off}
            // The selected state has to be announced, not just shaded.
            aria-pressed={selected}
            onClick={() => onChange(filter)}
          >
            {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
            {LABEL[filter]}
            {/* Quieter than the label only when the button is unselected. On the filled
                selected button, muted grey sits on a dark background and stops being
                readable, so the count takes the button's own foreground colour. */}
            {/* The button's own colour at low strength, so the count belongs to the button
                whatever kind it is. A zero is quieter than a count, but no quieter than the
                muted text elsewhere: it says "none of these", not "unavailable". */}
            <span
              className={`rounded bg-current/10 px-1 tabular-nums ${
                counts[filter] === 0 ? 'opacity-80' : ''
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
