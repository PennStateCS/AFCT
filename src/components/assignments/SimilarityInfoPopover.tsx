'use client';

import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MATCH_LABEL, type MatchType } from '@/lib/similarity/evidence';

/**
 * What a match type means, on demand.
 *
 * Two audiences read this page. Somebody who has used it before wants to scan and move on;
 * somebody meeting it for the first time needs to know what "exact artifact" is claiming
 * before they act on it. Putting the explanation behind a button serves both, and putting
 * the same explanation on every card would serve neither.
 */

const WHAT_THIS_MEANS: Record<MatchType, string> = {
  exact:
    'These submissions contain the same saved JFLAP artifact. The machine structure matches, and so does the saved layout, which for an automaton includes where each state sits in the drawing. Students do independently reach the same correct answer, but on a machine of any size it is much less likely that they independently save it with every state in the same place. This is strong evidence that the files share an origin. What that origin was is for you to judge.',
  'same-machine':
    'These submissions are the same underlying machine, but cosmetic details differ, such as state names or where things sit in the drawing. That is what a shared file looks like after somebody edits it, and it is also what two people can produce independently when a problem has one natural answer. Read the comparison and the timing alongside it.',
  structural:
    'These submissions are neither the same file nor the same machine, but they share structure the rest of the class does not: the same local features, the same relationships between states, the same layout characteristics, or the same unusual quirks. This is weaker evidence than an exact or same-machine match and is worth reading in context rather than on its own.',
  common:
    'Enough of the class submitted this same work that the similarity is most likely explained by everyone converging on the expected answer. It is kept for completeness and set aside so it does not crowd out the rest.',
};

const REUSE_EXPLANATION =
  'At least one submission here arrived after another student had already received a correct result for the same work. That is useful context about timing. It does not by itself establish what happened.';

export function SimilarityInfoPopover({
  type,
  facts,
  reusedAfterPass,
}: {
  type: MatchType;
  /** Statements about this match, each one something the detector actually computed. */
  facts: string[];
  reusedAfterPass?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* A real button with a real name: the explanation has to be reachable by keyboard
            and by a screen reader, not parked behind a hover. */}
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`Explain ${MATCH_LABEL[type].toLowerCase()} match`}
        >
          <Info className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 space-y-3 text-sm">
        <section className="space-y-1">
          <h4 className="font-semibold">What this means</h4>
          <p className="text-muted-foreground">{WHAT_THIS_MEANS[type]}</p>
        </section>

        {facts.length > 0 ? (
          <section className="space-y-1">
            <h4 className="font-semibold">This match</h4>
            <ul className="text-muted-foreground list-disc space-y-0.5 ps-5">
              {facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {reusedAfterPass ? (
          <section className="space-y-1">
            <h4 className="font-semibold">Reused after passing</h4>
            <p className="text-muted-foreground">{REUSE_EXPLANATION}</p>
          </section>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
