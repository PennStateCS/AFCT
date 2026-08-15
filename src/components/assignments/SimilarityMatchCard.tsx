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
} from './SimilarityEvidenceBadge';
import { SimilarityInfoPopover } from './SimilarityInfoPopover';
import { SimilarityTimeline } from './SimilarityTimeline';
import type { MatchCluster } from '@/lib/similarity/evidence';
import {
  clusterDetails,
  clusterFacts,
  clusterHeadline,
  relationshipSummary,
  sizeLabel,
  studentName,
} from './similarity-format';

/**
 * One group of related submissions.
 *
 * The first three lines carry the review: how strong the artifact evidence is, what kind of
 * match it is, and why that matters here. Everything after is detail for somebody who has
 * decided to look. Reuse after passing sits beside the kind rather than above it, because a
 * weaker artifact match does not become a stronger one because of when it arrived.
 *
 * A group of two is the whole card. A group of more than two keeps its relationships behind
 * one control, so a course where six students share work is one card to read rather than the
 * fifteen nearly identical ones the pairs would make.
 */
export function SimilarityMatchCard({
  cluster,
  onCompare,
  formatDay,
  formatTime,
  showProblem = false,
}: {
  cluster: MatchCluster;
  onCompare: (students: MatchSubmission[]) => void;
  formatDay: (iso: string) => string;
  formatTime: (iso: string) => string;
  /** Set in the common list, which is not grouped under a problem heading. */
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
      className={`space-y-3 rounded-lg border p-4 ${ACCENT_BORDER[cluster.type]} ${
        cluster.type === 'common' ? 'bg-muted/30' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SimilarityEvidenceBadge type={cluster.type} />
        {cluster.reusedAfterPass ? <ReusedAfterPassBadge /> : null}
        <SimilarityInfoPopover
          type={cluster.type}
          facts={clusterFacts(cluster)}
          reusedAfterPass={cluster.reusedAfterPass}
        />
        {size ? <span className="text-muted-foreground ms-auto text-sm">{size}</span> : null}
      </div>

      <div className="space-y-1">
        {/* The heading is the fact rather than the kind, because the badge above already
            says the kind and a reader who has read it once does not need it twice. */}
        <h4 id={headingId} className="font-semibold">
          {clusterHeadline(cluster)}
          {showProblem && cluster.problem.title ? (
            <span className="text-muted-foreground font-normal"> · {cluster.problem.title}</span>
          ) : null}
        </h4>
        {isGroup ? (
          <p className="text-muted-foreground text-sm">{relationshipSummary(cluster).join(' · ')}</p>
        ) : (
          <ul className="text-muted-foreground list-disc space-y-0.5 ps-5 text-sm">
            {details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>

      <SimilarityTimeline students={cluster.students} formatDay={formatDay} formatTime={formatTime} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        {isGroup ? (
          <Collapsible open={open} onOpenChange={setOpen} className="w-full">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                <ChevronDown
                  className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
                />
                {open ? 'Hide' : 'Review'} the {cluster.relationships.length} relationships
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              {/* Each relationship with its own compare, so a reader can go straight to the
                  two files a given claim is about rather than guessing from a group of six. */}
              <ul className="space-y-2">
                {cluster.relationships.map((relationship) => (
                  <li
                    key={relationship.matchId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm"
                  >
                    <span>
                      {[
                        ...new Set(relationship.submissions.map((s) => studentName(s.student))),
                      ].join(' and ')}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onCompare(relationship.submissions)}
                    >
                      <Columns2 />
                      Compare
                    </Button>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        <Button variant="secondary" size="sm" onClick={() => onCompare(cluster.students)}>
          <Columns2 />
          Compare submissions
          <span className="sr-only">
            {' '}
            for {cluster.students.map((s) => studentName(s.student)).join(' and ')}
          </span>
        </Button>
      </div>
    </article>
  );
}
