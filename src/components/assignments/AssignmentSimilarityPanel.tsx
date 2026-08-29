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
import { CommonThresholdSlider } from '@/components/assignments/CommonThresholdSlider';
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
import { FILTER_NOUN, type ReviewSubject } from '@/components/assignments/similarity-format';
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
  // Which problems the reader has opened. Closed is the starting point for all of them.
  const [openProblems, setOpenProblems] = useState<Record<string, boolean>>({});
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
    // Matched against what each card is LABELLED, so the cards behind a button are exactly
    // the ones carrying that badge.
    const shown =
      filter === 'all'
        ? reviewable
        : reviewable.filter((cluster) => cluster.displayType === filter);

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
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <Fingerprint className="h-6 w-6" />
        Similarity
      </h2>

      {/* The triage block: what is here, how to narrow it, and where the line between a
          finding and an expected answer currently sits. One card, not three, and never
          collapsible: it is the answer to "is there anything for me here", which is the
          question the page exists to answer first. */}
      {/* A container, so the threshold control below can ask how much room THIS CARD has
          rather than how wide the window is. The page sits inside a global sidebar and an
          assignment rail, either of which can be open, so the same screen gives the card
          very different widths and a viewport breakpoint would be guessing. */}
      <div className="bg-card @container/triage space-y-3 rounded-lg border p-4">
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
                <p
                  key={line}
                  className={
                    index === 0 ? 'text-base font-medium' : 'text-muted-foreground text-sm'
                  }
                >
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
                    FILTER_NOUN[filter]
                  } matches.`}
            </span>

            {/*
              The same setting, twice, and only ever one of them on the page: the card is
              either wide enough to hold the dial itself or it is not. Both drive the same
              state, so whichever one a reader has, moving it is the same act.
            */}
            <div className="text-muted-foreground ms-auto hidden flex-col items-end gap-1 text-sm @[40rem]/triage:flex">
              <Label htmlFor="common-share-inline" className="text-muted-foreground font-normal">
                Common-answer threshold
              </Label>
              <CommonThresholdSlider
                id="common-share-inline"
                value={commonShare}
                onChange={changeThreshold}
              />
            </div>

            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm @[40rem]/triage:hidden">
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
                  <CommonThresholdSlider
                    id="common-share"
                    value={commonShare}
                    onChange={changeThreshold}
                    grow
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        ) : null}
      </div>

      {/*
        One card per problem, closed to start.
        
        A reader arrives asking which problem needs them, not which student: the closed list
        answers that in a screen, and opening one is the decision to read it. Each card holds
        its own match cards rather than the page holding a flat run of them, so a problem with
        nine groups cannot bury the next problem underneath it.
      */}
      {sections.map(([problemId, section], index) => {
        const isOpen = openProblems[problemId] ?? false;
        const submitted =
          groupAssignment && section.groups > 0
            ? `${section.groups} group${section.groups === 1 ? '' : 's'} submitted`
            : `${section.students} student${section.students === 1 ? '' : 's'} submitted`;

        return (
          <Collapsible
            key={problemId}
            open={isOpen}
            onOpenChange={(open) =>
              setOpenProblems((previous) => ({ ...previous, [problemId]: open }))
            }
            asChild
          >
            <section className="bg-card overflow-hidden rounded-lg border">
              {/* The button is inside the heading, which is what makes the closed page read
                  as a list of problems to a screen reader rather than a list of buttons. */}
              <h3 className="text-lg font-semibold">
                <CollapsibleTrigger className="hover:bg-muted/60 focus-visible:ring-ring flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 p-4 text-start focus-visible:ring-2 focus-visible:outline-none">
                  <ChevronDown
                    className={`text-muted-foreground size-5 shrink-0 self-center transition-transform ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-muted-foreground font-normal">Problem {index + 1}</span>
                  <span className="text-muted-foreground font-normal">—</span>
                  <span>{section.title ?? 'Unknown problem'}</span>
                  <span className="text-muted-foreground ms-auto text-sm font-normal">
                    {submitted} · {section.clusters.length} match group
                    {section.clusters.length === 1 ? '' : 's'}
                  </span>
                </CollapsibleTrigger>
              </h3>

              {/* Nothing inside is drawn until it is asked for: a problem can hold thirty
                  students' attempts, and this page is read one problem at a time. */}
              <CollapsibleContent className="bg-muted/30 space-y-3 border-t p-4">
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
              </CollapsibleContent>
            </section>
          </Collapsible>
        );
      })}

      {/* Choosing a kind with nothing in it is a question, and it deserves an answer rather
          than a page that appears to have lost its contents. */}
      {filter !== 'all' && sections.length === 0 ? (
        <p className="bg-card text-muted-foreground rounded-lg border p-4 text-sm">
          No {FILTER_NOUN[filter]} matches were found for this assignment.
        </p>
      ) : null}

      {setAside.length > 0 ? (
        <Collapsible open={showCommon} onOpenChange={setShowCommon} asChild>
          {/* The same card as a problem. It was a shade darker to mark it as the section
              read last, but on a page of white cards one grey one reads as disabled rather
              than as quieter, and its heading already says what it holds. */}
          <section className="bg-card overflow-hidden rounded-lg border">
            <h3 className="text-base font-semibold">
              <CollapsibleTrigger className="hover:bg-muted/60 focus-visible:ring-ring flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 p-4 text-start focus-visible:ring-2 focus-visible:outline-none">
                <ChevronDown
                  className={`text-muted-foreground size-5 shrink-0 self-center transition-transform ${
                    showCommon ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
                <Users
                  className="text-muted-foreground size-4 shrink-0 self-center"
                  aria-hidden="true"
                />
                <span>Set aside ({setAside.length})</span>
                <span className="text-muted-foreground ms-auto text-sm font-normal">
                  Common answers and the instructor&apos;s own solution
                </span>
              </CollapsibleTrigger>
            </h3>

            {/* Nothing renders until it is asked for: some of these hold thirty students. */}
            <CollapsibleContent className="space-y-3 border-t p-4">
              <p className="text-muted-foreground max-w-3xl text-sm">
                Work at least {Math.round(commonShare * 100)}% of a problem&apos;s{' '}
                {groupAssignment ? 'groups' : 'students'} submitted, and work that is the solution
                the instructor posted. Both explain a match rather than raising one.
              </p>
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
          </section>
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
