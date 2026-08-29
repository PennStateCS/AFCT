'use client';

import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DISPLAY_LABEL, type DisplayMatchType } from '@/lib/similarity/evidence';

/**
 * What a match type means, on demand.
 *
 * Two audiences read this page. Somebody who has used it before wants to scan and move on;
 * somebody meeting it for the first time needs to know what "exact artifact" is claiming
 * before they act on it. Putting the explanation behind a button serves both, and putting
 * the same explanation on every card would serve neither.
 */

const WHAT_THIS_MEANS: Record<DisplayMatchType, string> = {
  'byte-identical':
    'These submissions are the same file to the byte: not the same work, not the same file once formatting is set aside, the same bytes. Nothing was normalised away to reach that, so there is no incidental difference left for it to hide. Two people building the same machine independently produce files that differ somewhere, in a name, a coordinate or the order things were saved in. This is the strongest statement this page can make about two files. What it means about how they came to be identical is for you to judge.',
  exact:
    'These submissions contain the same saved JFLAP artifact. The machine structure matches, and so does the saved layout, which for an automaton includes where each state sits in the drawing. Students do independently reach the same correct answer, but on a machine of any size it is much less likely that they independently save it with every state in the same place. This is strong evidence that the files share an origin. What that origin was is for you to judge.',
  'same-machine':
    'These submissions are the same underlying machine, but cosmetic details differ, such as state names or where things sit in the drawing. That is what a shared file looks like after somebody edits it, and it is also what two people can produce independently when a problem has one natural answer. Read the comparison and the timing alongside it.',
  structural:
    'These submissions are neither the same file nor the same machine, but they share structure the rest of the class does not: the same local features, the same relationships between states, the same layout characteristics, or the same unusual quirks. This is weaker evidence than an exact or same-machine match and is worth reading in context rather than on its own.',
  reference:
    'This work is the reference solution posted for the problem. Everybody holding that file has the same artifact by definition, so how alike these submissions are says nothing about how each student arrived at it. It is kept for completeness and set aside so it does not crowd out the rest.',
  common:
    'Enough of the class submitted this same work that the similarity is most likely explained by everyone converging on the expected answer. It is kept for completeness and set aside so it does not crowd out the rest.',
};

/**
 * The kinds in the order the page ranks them, for the whole-page explanation. The two at the
 * end are the set-aside ones, which are on the page too and are the pair most likely to be
 * misread as findings.
 */
const HELP_ORDER: DisplayMatchType[] = [
  'byte-identical',
  'exact',
  'same-machine',
  'structural',
  'reference',
  'common',
];

/**
 * How to read the page, rather than how to read one card.
 *
 * The same paragraphs the cards explain themselves with, gathered in one place and reachable
 * before a reader has opened anything. Somebody meeting this tab for the first time has the
 * question "what am I looking at" before they have a card in front of them, and an icon
 * beside a heading was not an answer they could find.
 */
export function SimilarityHelpPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* The words when the card has room for them, the icon alone when it does not. The
            name never changes with the width: aria-label carries it either way, so a screen
            reader hears the same control on a phone as on a desktop. */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-label="What these results mean"
        >
          <Info className="size-4" aria-hidden="true" />
          <span aria-hidden="true" className="hidden @[26rem]/triage:inline @[48rem]/triage:hidden">
            What this means
          </span>
          <span aria-hidden="true" className="hidden @[48rem]/triage:inline">
            What these results mean
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        /* Long enough to need scrolling on a short window, and a scroll container a keyboard
           can reach: Radix focuses this element when it opens. */
        className="max-h-[70vh] w-96 space-y-3 overflow-y-auto text-sm"
      >
        <h4 className="font-semibold">What these results mean</h4>
        {/* Said here rather than on the page: the overlap only puzzles somebody who has
            noticed the numbers do not add up, and they are the person who opens this. */}
        <p className="text-muted-foreground">
          Filters show review groups containing each type of similarity relationship. A review group
          may contain more than one relationship type, so filter counts can overlap.
        </p>
        {HELP_ORDER.map((kind) => (
          <section key={kind} className="space-y-1">
            <h5 className="font-medium">{DISPLAY_LABEL[kind]}</h5>
            <p className="text-muted-foreground">{WHAT_THIS_MEANS[kind]}</p>
          </section>
        ))}
      </PopoverContent>
    </Popover>
  );
}

const REUSE_EXPLANATION =
  "At least one submission here arrived after another student's copy of the same work had already been marked correct, measured from when that result landed rather than when it was submitted. That is useful context about timing. It does not by itself establish what happened.";

export function SimilarityInfoPopover({
  type,
  facts,
  reusedAfterPass,
}: {
  type: DisplayMatchType;
  /** Statements about this match, each one something the detector actually computed. */
  facts: string[];
  reusedAfterPass?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* The same control as the one beside the page heading, saying the same thing in the
            same way: words where the card has room for them, the icon alone where it does
            not. The name adds which kind this particular card is about, so a reader moving
            between buttons is not offered five identical ones, and it begins with the words
            on the button so what is seen and what is announced cannot disagree. */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-label={`What this means: ${DISPLAY_LABEL[type]
            .toLowerCase()
            .replace('jflap', 'JFLAP')} match`}
        >
          <Info className="size-4" aria-hidden="true" />
          <span aria-hidden="true" className="hidden @[36rem]/match:inline">
            What this means
          </span>
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
