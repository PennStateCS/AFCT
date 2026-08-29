'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Columns2 } from 'lucide-react';
import type { MatchSubmission } from '@/lib/similarity/matches';
import {
  SimilarityEvidenceBadge,
  ReusedAfterPassBadge,
  RelatedSubmissionsBadge,
  ACCENT_BORDER,
} from './SimilarityEvidenceBadge';
import { SimilarityInfoPopover } from './SimilarityInfoPopover';
import { SimilarityTimeline } from './SimilarityTimeline';
import { STRENGTH_OF, matchTypeOf, type MatchCluster } from '@/lib/similarity/evidence';
import {
  attemptLabel,
  clusterDetails,
  listOf,
  clusterFacts,
  clusterHeadline,
  relationshipDetails,
  relationshipParticipants,
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
  const details = clusterDetails(cluster, subject);
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
      className={`rounded-lg border p-4 sm:p-5 ${
        // A mixed group takes the neutral edge: the colour of its strongest relationship
        // would be colouring the whole card by something true of part of it.
        cluster.homogeneous ? ACCENT_BORDER[cluster.type] : ACCENT_BORDER.common
      } ${STRENGTH_OF[cluster.type] === 'none' ? 'bg-muted' : 'bg-card'}`}
    >
      {/* Kind and size on one line: what this is, and how big the work is, before anything
          else. Everything below is read in order after them. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {cluster.homogeneous ? (
          <SimilarityEvidenceBadge type={cluster.type} />
        ) : (
          <RelatedSubmissionsBadge count={cluster.relationships.length} />
        )}
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
                    {listOf([...new Set(cluster.attempts.map((s) => studentName(s.student)))])}
                  </span>
                </Button>
              </div>
            </div>

            <CollapsibleContent className="pt-3">
              {/* Each relationship with its own kind and its own compare, so a reader can go
                  straight to the files a given claim is about rather than guessing from a
                  group of six. Quieter than the card that holds them: same information, one
                  level down. */}
              <ul aria-label="Relationships in this group" className="space-y-2">
                {cluster.relationships.map((relationship) => {
                  const type = matchTypeOf(relationship, commonShare);
                  const participants = relationshipParticipants(relationship, subject);
                  return (
                    <li
                      key={relationship.matchId}
                      className="bg-background/60 space-y-2 rounded-md border px-3 py-2.5 text-sm"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1.5">
                          <SimilarityEvidenceBadge type={type} />

                          {/* Each participant with the attempts of theirs that are IN this
                              relationship. "Attempts 1 and 2" over three names leaves whose
                              unanswered, which is the question a reader actually has. */}
                          <ul className="space-y-0.5">
                            {participants.map((participant) => (
                              <li key={participant.id} className="flex flex-wrap gap-x-2">
                                <span className="font-medium">{participant.name}</span>
                                <span className="text-muted-foreground">
                                  {participant.attempts
                                    .map((attempt) => attemptLabel(attempt.attempt))
                                    .join(', ')}
                                </span>
                                {subject === 'group' && participant.attempts[0]?.studentGroup ? (
                                  <span className="text-muted-foreground text-xs">
                                    submitted by{' '}
                                    {participant.attempts
                                      .map((attempt) => studentName(attempt.student))
                                      .join(', ')}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
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
                            {listOf(participants.map((participant) => participant.name))}
                          </span>
                        </Button>
                      </div>

                      {/* What THIS relationship can say for itself, which is not always what
                          the card above it says. */}
                      <ul className="text-muted-foreground list-disc space-y-0.5 ps-5 text-xs">
                        {relationshipDetails(relationship, subject).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
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
                for {listOf([...new Set(cluster.attempts.map((s) => studentName(s.student)))])}
              </span>
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
