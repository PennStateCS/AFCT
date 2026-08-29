'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Columns2 } from 'lucide-react';
import type { MatchSubmission } from '@/lib/similarity/matches';
import {
  SimilarityEvidenceBadge,
  ReusedAfterPassBadge,
  ACCENT_BORDER,
  MATCH_ICON,
} from './SimilarityEvidenceBadge';
import { SimilarityInfoPopover } from './SimilarityInfoPopover';
import { SimilarityTimeline } from './SimilarityTimeline';
import {
  MATCH_LABEL,
  STRENGTH_LABEL,
  STRENGTH_OF,
  matchTypeOf,
  type MatchCluster,
} from '@/lib/similarity/evidence';
import {
  clusterDetails,
  clusterFacts,
  clusterHeadline,
  relationshipAttempts,
  relationshipParties,
  sizeLabel,
  studentName,
  type ReviewSubject,
} from './similarity-format';

/**
 * One group of related submissions.
 *
 * The first lines carry the review: how strong the artifact evidence is, what kind of match
 * it is, and why that matters here. Then the attempts themselves, because which attempt
 * matched is the thing being reviewed. Everything after is detail for somebody who has
 * decided to look. Reuse after passing sits beside the kind rather than above it, because a
 * weaker artifact match does not become a stronger one because of when it arrived.
 *
 * A group of two is the whole card. A group of more than two keeps its relationships behind
 * one control, so a course where six students share work is one card to read rather than the
 * fifteen nearly identical ones the pairs would make. Compare then belongs to a relationship
 * rather than to the whole group: the evidence is about the files in that relationship.
 */
export function SimilarityMatchCard({
  cluster,
  subject,
  commonShare,
  onCompare,
  formatDay,
  formatTime,
  showProblem = false,
}: {
  cluster: MatchCluster;
  /** Whether this assignment is reviewed as students or as groups. */
  subject: ReviewSubject;
  /** The reader's commonality setting, so each relationship can name its own kind. */
  commonShare: number;
  onCompare: (submissions: MatchSubmission[]) => void;
  formatDay: (iso: string) => string;
  formatTime: (iso: string) => string;
  /** Set in the set-aside list, which is not grouped under a problem heading. */
  showProblem?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const headingId = `match-${cluster.id}-heading`;
  const size = sizeLabel(cluster);
  const details = clusterDetails(cluster);
  const isGroup = cluster.relationships.length > 1;

  return (
    <article
      aria-labelledby={headingId}
      /*
       * bg-card, like the cards everywhere else. These were transparent, which was invisible
       * while the workspace was white and left the tab reading as a list of outlines.
       *
       * A set-aside group is explained rather than acted on, so it stays quieter: bg-muted,
       * one step off the card the others sit on. It was `bg-muted/30`, which over the page
       * rather than over a card came out within a percent or two of no fill at all, so the one
       * thing the tint had to do, tell a set-aside group from a live one, it did not do.
       */
      className={`rounded-lg border p-4 sm:p-5 ${ACCENT_BORDER[cluster.type]} ${
        STRENGTH_OF[cluster.type] === 'none' ? 'bg-muted' : 'bg-card'
      }`}
    >
      {/* Kind and size on one line: what this is, and how big the work is, before anything
          else. Everything below is read in order after them. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SimilarityEvidenceBadge type={cluster.type} />
        {cluster.reusedAfterPass ? <ReusedAfterPassBadge /> : null}
        {size ? (
          <span className="text-muted-foreground ms-auto text-sm tabular-nums">{size}</span>
        ) : null}
      </div>

      <div className="space-y-1.5">
        {/* The heading is the fact rather than the kind, because the badge above already
            says the kind and a reader who has read it once does not need it twice. */}
        <h4 id={headingId} className="text-base leading-snug font-semibold">
          {clusterHeadline(cluster, subject)}
          {showProblem && cluster.problem.title ? (
            <span className="text-muted-foreground font-normal"> · {cluster.problem.title}</span>
          ) : null}
        </h4>
        <ul className="text-muted-foreground list-disc space-y-0.5 ps-5 text-sm">
          {details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <SimilarityTimeline
          attempts={cluster.attempts}
          subject={subject}
          formatDay={formatDay}
          formatTime={formatTime}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        {isGroup ? (
          <Collapsible open={open} onOpenChange={setOpen} className="w-full">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CollapsibleTrigger asChild>
                <Button variant="secondary" size="sm">
                  <ChevronDown
                    className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
                  />
                  {open ? 'Hide' : 'Review'} the {cluster.relationships.length} relationships
                </Button>
              </CollapsibleTrigger>

              <div className="flex flex-wrap items-center gap-2">
                <SimilarityInfoPopover
                  type={cluster.type}
                  facts={clusterFacts(cluster, subject)}
                  reusedAfterPass={cluster.reusedAfterPass}
                />
                {/* Comparing everybody at once stays available, but secondary: in a group held
                  together by a shared student, the evidence belongs to the relationships,
                  and reviewing them one at a time is the thing to do first. */}
                <Button variant="ghost" size="sm" onClick={() => onCompare(cluster.attempts)}>
                  <Columns2 />
                  Compare all
                  <span className="sr-only">
                    {' '}
                    {cluster.attempts.map((s) => studentName(s.student)).join(' and ')}
                  </span>
                </Button>
              </div>
            </div>

            <CollapsibleContent className="pt-3">
              {/* Each relationship with its own kind and its own compare, so a reader can go
                  straight to the files a given claim is about rather than guessing from a
                  group of six. Quieter than the card that holds them: same information, one
                  level down. */}
              <ul className="space-y-2">
                {cluster.relationships.map((relationship) => {
                  const type = matchTypeOf(relationship, commonShare);
                  const strength = STRENGTH_OF[type];
                  const attempts = relationshipAttempts(relationship);
                  const Icon = MATCH_ICON[type];
                  return (
                    <li
                      key={relationship.matchId}
                      className="bg-background/60 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <div className="flex min-w-0 items-start gap-2">
                        <Icon
                          className="text-muted-foreground mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <p className="font-medium">
                            {relationshipParties(relationship, subject)}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {strength === 'none'
                              ? MATCH_LABEL[type]
                              : `${STRENGTH_LABEL[strength]} · ${MATCH_LABEL[type]}`}
                            {attempts ? ` · ${attempts}` : ''}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onCompare(relationship.submissions)}
                      >
                        <Columns2 />
                        Compare
                        <span className="sr-only">
                          {' '}
                          {relationshipParties(relationship, subject)}
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <>
            <SimilarityInfoPopover
              type={cluster.type}
              facts={clusterFacts(cluster, subject)}
              reusedAfterPass={cluster.reusedAfterPass}
            />
            <Button variant="secondary" size="sm" onClick={() => onCompare(cluster.attempts)}>
              <Columns2 />
              Compare submissions
              <span className="sr-only">
                {' '}
                for {cluster.attempts.map((s) => studentName(s.student)).join(' and ')}
              </span>
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
