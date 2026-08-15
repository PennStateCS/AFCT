'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { ChevronDown, Fingerprint } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import Spinner from '@/components/ui/spinner';
import { CompareSubmissionsDialog } from '@/components/assignments/CompareSubmissionsDialog';
import { SimilarityMatchCard } from '@/components/assignments/SimilarityMatchCard';
import { summarise } from '@/components/assignments/similarity-format';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api/fetch-client';
import { COMMON_SHARE, isCommon } from '@/lib/similarity/rarity';
import {
  formatDateInTimeZone,
  formatTimeInTimeZone,
  zoneAbbrev,
  parseValidDate,
} from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { SubmissionMatchGroup, MatchSubmission } from '@/lib/similarity/matches';

/**
 * Submissions to this assignment that hold the same work as somebody else's.
 *
 * Staff-only: rendered inside PrivilegeAssignmentView, which the server renders only for
 * admins and the course's FACULTY/TA.
 *
 * The page is ordered by the questions a reader asks, in the order they ask them. Is there
 * anything to review; in which problem; what kind of match; how unusual; when; who; and only
 * then, shall I look at the files. Matches most of the class shares fold away at the bottom,
 * because they are less useful rather than more serious.
 *
 * It reports and never accuses. No verdict is stored, no percentage of similarity is shown,
 * and the words on it stay factual.
 */

/** Where the reader's own commonality setting is kept, so it survives a reload. */
const THRESHOLD_KEY = 'afct.similarityCommonShare';

export function AssignmentSimilarityPanel() {
  const { id: courseId, aid: assignmentId } = useParams<{ id: string; aid: string }>();
  const { timezone } = useEffectiveTimezone();
  // Controlled rather than left to the component: the trigger's label is its accessible
  // name, and rendering both words with one hidden by CSS makes that name depend on
  // stylesheets having loaded.
  const [showCommon, setShowCommon] = useState(false);
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

  const { sections, common } = useMemo(() => {
    const groups = data ?? [];

    // Grouped under their problem, and the problem holding the least ordinary match comes
    // first, so what needs reading is at the top of the page rather than in the middle.
    const byProblem = new Map<
      string,
      { title: string | null; students: number; matches: SubmissionMatchGroup[] }
    >();
    for (const group of groups.filter((group) => !isCommon(group, commonShare))) {
      const section = byProblem.get(group.problem.id) ?? {
        title: group.problem.title,
        students: group.problemStudentCount,
        matches: [],
      };
      section.matches.push(group);
      byProblem.set(group.problem.id, section);
    }

    return {
      sections: [...byProblem.entries()].sort(
        ([, a], [, b]) => (a.matches[0]?.studentCount ?? 0) - (b.matches[0]?.studentCount ?? 0),
      ),
      common: groups.filter((group) => isCommon(group, commonShare)),
    };
  }, [data, commonShare]);

  const worthReviewing = sections.flatMap(([, section]) => section.matches);
  const summary = summarise(worthReviewing, common.length);

  const compare = (students: MatchSubmission[], problem: SubmissionMatchGroup['problem']) =>
    setComparing({
      submissions: students,
      problemType: problem.type,
      problemTitle: problem.title,
    });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-2xl font-semibold">
          <Fingerprint className="h-6 w-6" />
          Similarity
        </h2>

        {/* One live region for the state of the page, so a screen reader hears the answer
            once rather than a card at a time. */}
        <div aria-live="polite" className="max-w-3xl">
          {isLoading ? (
            <div className="flex items-center gap-3 text-sm">
              <Spinner />
              <span>Looking for matching submissions...</span>
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

        {(data?.length ?? 0) > 0 ? (
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            <span>Common threshold: {Math.round(commonShare * 100)}%</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm">
                  Adjust<span className="sr-only"> the common threshold</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="common-share" className="text-sm font-medium">
                    Common threshold
                  </Label>
                  <p className="text-muted-foreground text-sm">
                    Work shared by at least this share of a problem&apos;s students is treated as
                    the expected answer and set aside at the bottom of the page.
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
                  <span className="w-12 text-sm tabular-nums">{Math.round(commonShare * 100)}%</span>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        ) : null}
      </div>

      {sections.map(([problemId, section]) => (
        <section key={problemId} className="max-w-3xl space-y-3">
          <div>
            <h3 className="text-lg font-semibold">{section.title ?? 'Unknown problem'}</h3>
            <p className="text-muted-foreground text-sm">
              {section.students} student{section.students === 1 ? '' : 's'} submitted ·{' '}
              {section.matches.length} match{section.matches.length === 1 ? '' : 'es'}
            </p>
          </div>

          {section.matches.map((group) => (
            <SimilarityMatchCard
              key={group.matchId}
              group={group}
              onCompare={(students) => compare(students, group.problem)}
              formatDay={formatDay}
              formatTime={formatTime}
            />
          ))}
        </section>
      ))}

      {common.length > 0 ? (
        <Collapsible open={showCommon} onOpenChange={setShowCommon} className="max-w-3xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <div>
              <h3 className="text-lg font-semibold">Common matches ({common.length})</h3>
              <p className="text-muted-foreground text-sm">
                Answers shared by at least {Math.round(commonShare * 100)}% of a problem&apos;s
                students.
              </p>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm">
                <ChevronDown className={showCommon ? 'rotate-180 transition-transform' : 'transition-transform'} />
                {showCommon ? 'Hide' : 'Show'} common matches
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="space-y-3">
            {common.map((group) => (
              <SimilarityMatchCard
                key={group.matchId}
                group={group}
                common
                showProblem
                onCompare={(students) => compare(students, group.problem)}
                formatDay={formatDay}
                formatTime={formatTime}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <CompareSubmissionsDialog
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
