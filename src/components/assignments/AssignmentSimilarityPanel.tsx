'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { ChevronDown, Fingerprint, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import Spinner from '@/components/ui/spinner';
import { CompareSubmissionsDialog } from '@/components/assignments/CompareSubmissionsDialog';
import { SimilarityMatchCard } from '@/components/assignments/SimilarityMatchCard';
import { SimilarityFilters, type MatchFilter } from '@/components/assignments/SimilarityFilters';
import {
  clusterMatches,
  countByType,
  isSetAside,
  summarise,
  type MatchCluster,
} from '@/lib/similarity/evidence';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api/fetch-client';
import { COMMON_SHARE } from '@/lib/similarity/rarity';
import type { ReviewSubject } from '@/components/assignments/similarity-format';
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
  zoneAbbrev,
  parseValidDate,
} from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { SubmissionMatchGroup, MatchSubmission } from '@/lib/similarity/matches';

/**
 * Submissions to this assignment that hold related work.
 *
 * Staff-only: rendered inside PrivilegeAssignmentView, which the server renders only for
 * admins and the course's FACULTY/TA.
 *
 * The page is built around what an instructor asks, in order. Is there anything to review;
 * how strong is it; in which problem; who is involved; and only then, shall I look at the
 * files. Related submissions are one group rather than a card per pair, because a course
 * where six students share work should be one thing to read rather than fifteen. Answers
 * most of the class gave fold away at the bottom, being less useful rather than more
 * serious.
 *
 * It reports and never accuses. Strength describes the artifact evidence, no verdict is
 * stored, no percentage of similarity is shown, and the words stay factual.
 */

/** Where the reader's own commonality setting is kept, so it survives a reload. */
const THRESHOLD_KEY = 'afct.similarityCommonShare';

export function AssignmentSimilarityPanel({
  groupAssignment = false,
}: {
  /**
   * Whether this assignment is submitted by groups, which the assignment page already knows
   * from its group set. It decides who a finding is about: on a group assignment any member
   * may submit for the team, so counting members would report two teams sharing work as four
   * students. Passed in rather than fetched again here.
   */
  groupAssignment?: boolean;
} = {}) {
  const subject: ReviewSubject = groupAssignment ? 'group' : 'student';
  const { id: courseId, aid: assignmentId } = useParams<{ id: string; aid: string }>();
  const { timezone } = useEffectiveTimezone();
  const [showCommon, setShowCommon] = useState(false);
  const [filter, setFilter] = useState<MatchFilter>('all');
  const [comparing, setComparing] = useState<{
    submissions: MatchSubmission[];
    problemType: string | null;
    problemTitle: string | null;
  } | null>(null);

  // How much of a class has to share work before it reads as the answer rather than a
  // finding. There is no right number: it depends on the problem and on how the course is
  // taught, so the reader gets the dial. Their own setting, and it changes what is shown,
  // never what is recorded.
  const [commonShare, setCommonShare] = useState(COMMON_SHARE);
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(THRESHOLD_KEY));
    if (Number.isFinite(saved) && saved > 0 && saved <= 1) setCommonShare(saved);
  }, []);
  const changeThreshold = (value: number) => {
    setCommonShare(value);
    try {
      window.localStorage.setItem(THRESHOLD_KEY, String(value));
    } catch {
      /* ignore storage the browser will not give us */
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.assignment.similarity(courseId, assignmentId),
    queryFn: () =>
      apiClient.get<SubmissionMatchGroup[]>(apiPaths.assignmentSimilarity(courseId, assignmentId)),
    enabled: !!courseId && !!assignmentId,
    staleTime: 30_000,
  });

  const formatDay = (iso: string) => {
    const date = parseValidDate(iso);
    return date ? formatDateInTimeZone(date, timezone) : 'Unknown';
  };
  const formatTime = (iso: string) => {
    const date = parseValidDate(iso);
    return date ? `${formatTimeInTimeZone(date, timezone)} ${zoneAbbrev(date, timezone)}` : '';
  };
  const formatFull = (iso: string) => `${formatDay(iso)} ${formatTime(iso)}`.trim();

  const clusters = useMemo(
    () => clusterMatches(data ?? [], commonShare, subject),
    [data, commonShare, subject],
  );

  // Set aside rather than reviewed: what the class as a whole answered, and what the
  // instructor handed out. Both explain a match instead of raising one.
  const worthReviewing = clusters.filter((cluster) => !isSetAside(cluster.type));
  const setAside = clusters.filter((cluster) => isSetAside(cluster.type));
  const summary = summarise(clusters);
  // Counted over what the filters can actually show, so "All 6" and six cards agree.
  const counts = countByType(worthReviewing);

  // Grouped under their problem, with the strongest evidence first inside each, and the
  // problem holding the strongest first on the page.
  const sections = useMemo(() => {
    // Only the review kinds are offered as filters; the set-aside ones have their own
    // section below, with their own count and their own control.
    // Derived from `clusters` rather than from the list above, so this memo depends only on
    // values it can see change.
    const reviewable = clusters.filter((cluster) => !isSetAside(cluster.type));
    const shown =
      filter === 'all' ? reviewable : reviewable.filter((cluster) => cluster.type === filter);

    const byProblem = new Map<
      string,
      { title: string | null; students: number; groups: number; clusters: MatchCluster[] }
    >();
    for (const cluster of shown) {
      const section = byProblem.get(cluster.problem.id) ?? {
        title: cluster.problem.title,
        students: cluster.problemStudentCount,
        // Only counted when the work actually carries groups, so a group assignment whose
        // older submissions have none falls back to the true student count rather than an
        // invented team one.
        groups: cluster.problemGroupCount,
        clusters: [],
      };
      section.clusters.push(cluster);
      byProblem.set(cluster.problem.id, section);
    }
    return [...byProblem.entries()];
  }, [clusters, filter]);

  const compare = (students: MatchSubmission[], problem: MatchCluster['problem']) =>
    setComparing({
      submissions: students,
      problemType: problem.type,
      problemTitle: problem.title,
    });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Fingerprint className="h-6 w-6" />
          Similarity
        </h2>

        {/* One live region for the state of the page, so a screen reader hears the answer
            once rather than a card at a time. */}
        <div aria-live="polite">
          {isLoading ? (
            <div className="flex items-center gap-3 text-sm">
              <Spinner />
              <span>Looking for related submissions...</span>
            </div>
          ) : (
            <div className="space-y-1">
              {summary.map((line, index) => (
                <p key={line} className={index === 0 ? 'text-base font-medium' : 'text-sm'}>
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>

        {clusters.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SimilarityFilters counts={counts} value={filter} onChange={setFilter} />

            {/*
              What the filter did, announced. The summary above is computed from every cluster,
              so narrowing thirty groups down to two changed the page and said nothing.
            */}
            <span aria-live="polite" className="sr-only">
              {filter === 'all'
                ? ''
                : `Showing ${sections.reduce((n, [, section]) => n + section.clusters.length, 0)} ${
                    filter === 'common' ? 'common' : filter
                  } matches.`}
            </span>

            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
              <span>Common-answer threshold: {Math.round(commonShare * 100)}%</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm">
                    Adjust<span className="sr-only"> the common threshold</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="common-share" className="text-sm font-medium">
                      Common-answer threshold
                    </Label>
                    <p className="text-muted-foreground text-sm">
                      Work shared by at least this share of a problem&apos;s{' '}
                      {groupAssignment ? 'groups' : 'students'} is treated as the expected answer
                      and set aside at the bottom of the page.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      id="common-share"
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={commonShare}
                      aria-valuetext={`${Math.round(commonShare * 100)} percent of the class`}
                      onChange={(event) => changeThreshold(Number(event.target.value))}
                      className="bg-primary-foreground accent-primary h-2 flex-1 cursor-pointer rounded-lg"
                    />
                    <span className="w-12 text-sm tabular-nums">
                      {Math.round(commonShare * 100)}%
                    </span>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        ) : null}
      </div>

      {sections.map(([problemId, section]) => (
        <section key={problemId} className="space-y-3">
          <div>
            <h3 className="text-lg font-semibold">{section.title ?? 'Unknown problem'}</h3>
            <p className="text-muted-foreground text-sm">
              {groupAssignment && section.groups > 0
                ? `${section.groups} group${section.groups === 1 ? '' : 's'} submitted`
                : `${section.students} student${section.students === 1 ? '' : 's'} submitted`}{' '}
              · {section.clusters.length} match group
              {section.clusters.length === 1 ? '' : 's'}
            </p>
          </div>

          {section.clusters.map((cluster) => (
            <SimilarityMatchCard
              key={cluster.id}
              cluster={cluster}
              subject={subject}
              commonShare={commonShare}
              onCompare={(submissions) => compare(submissions, cluster.problem)}
              formatDay={formatDay}
              formatTime={formatTime}
            />
          ))}
        </section>
      ))}

      {setAside.length > 0 ? (
        <Collapsible open={showCommon} onOpenChange={setShowCommon} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <Users className="size-5" aria-hidden="true" />
                Set aside ({setAside.length})
              </h3>
              <p className="text-muted-foreground text-sm">
                Work at least {Math.round(commonShare * 100)}% of a problem&apos;s{' '}
                {groupAssignment ? 'groups' : 'students'} submitted, and work that is the solution
                the instructor posted. Both explain a match rather than raising one.
              </p>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm">
                <ChevronDown
                  className={
                    showCommon ? 'rotate-180 transition-transform' : 'transition-transform'
                  }
                />
                {showCommon ? 'Hide' : 'Show'} set-aside groups
              </Button>
            </CollapsibleTrigger>
          </div>

          {/* Nothing renders until it is asked for: some of these hold thirty students. */}
          <CollapsibleContent className="space-y-3">
            {setAside.map((cluster) => (
              <SimilarityMatchCard
                key={cluster.id}
                cluster={cluster}
                subject={subject}
                commonShare={commonShare}
                showProblem
                onCompare={(submissions) => compare(submissions, cluster.problem)}
                formatDay={formatDay}
                formatTime={formatTime}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <CompareSubmissionsDialog
        subject={subject}
        open={comparing !== null}
        onOpenChange={(open) => !open && setComparing(null)}
        submissions={comparing?.submissions ?? null}
        problemType={comparing?.problemType ?? null}
        problemTitle={comparing?.problemTitle ?? null}
        formatSubmittedAt={formatFull}
      />
    </div>
  );
}
