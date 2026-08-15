'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiPaths } from '@/lib/api-paths';
import type { SubmissionMatchGroup, MatchSubmission } from '@/lib/similarity/matches';
import {
  elapsedLabel,
  matchDetails,
  matchHeadline,
  matchTitle,
  resultLabel,
  studentName,
  studentsInOrder,
} from './similarity-format';

/**
 * One match: what kind it is, what it means, who was involved and in what order, and the
 * one action worth taking.
 *
 * The order of the card is the order the questions get asked. What kind of match, then the
 * counts that say how unusual it is, then the chronology, then Compare. Everything else is
 * quieter, and nothing on it decides anything.
 */
export function SimilarityMatchCard({
  group,
  common,
  onCompare,
  formatDay,
  formatTime,
  showProblem = false,
}: {
  group: SubmissionMatchGroup;
  /** Shared by enough of the class to be the answer rather than a finding. */
  common?: boolean;
  onCompare: (students: MatchSubmission[]) => void;
  /** "08/14/26", shown when a match runs across more than one day. */
  formatDay: (iso: string) => string;
  /** "10:42 PM", which is what the chronology reads on. */
  formatTime: (iso: string) => string;
  /** Set for the common list, which is not grouped under a problem heading. */
  showProblem?: boolean;
}) {
  const students = studentsInOrder(group);
  const firstAt = students[0] ? Date.parse(students[0].submittedAt) : 0;
  const spansDays =
    new Set(students.map((submission) => formatDay(submission.submittedAt))).size > 1;

  return (
    <article
      className={
        common ? 'bg-muted/30 space-y-3 rounded-lg border p-4' : 'space-y-3 rounded-lg border p-4'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h4 className="font-semibold">
            {common ? 'Common answer' : matchTitle(group)}
            {showProblem && group.problem.title ? (
              <span className="text-muted-foreground font-normal"> · {group.problem.title}</span>
            ) : null}
          </h4>
        </div>
        {/* The one status that changes what a reader does with the card, and the only one
            given any weight. The rest are sentences below. */}
        {group.reusedAfterPass ? <Badge variant="warning">Reused after passing</Badge> : null}
      </div>

      <div className="space-y-1 text-sm">
        <p className={common ? 'text-muted-foreground' : ''}>{matchHeadline(group)}</p>
        {matchDetails(group).map((line) => (
          <p key={line} className="text-muted-foreground">
            {line}
          </p>
        ))}
        {group.matchesAnswerFile ? (
          <p className="text-muted-foreground">Matches the instructor reference solution.</p>
        ) : null}
        {common ? (
          <p className="text-muted-foreground">
            Submitted by enough of the class to be the expected answer.
          </p>
        ) : null}
      </div>

      {/* An ordered list, and every relationship spelled out in words: the order, the gaps
          and who was first all have to survive being read aloud, with no lines or arrows to
          look at. */}
      <ol className="divide-border divide-y text-sm">
        {students.map((submission, index) => {
          const name = studentName(submission.student);
          const elapsed = index === 0 ? null : elapsedLabel(Date.parse(submission.submittedAt) - firstAt);
          return (
            <li
              key={submission.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
            >
              <time dateTime={submission.submittedAt} className="tabular-nums">
                {spansDays
                  ? `${formatDay(submission.submittedAt)} ${formatTime(submission.submittedAt)}`
                  : formatTime(submission.submittedAt)}
              </time>
              <span className="font-medium">{name}</span>
              <span className="text-muted-foreground">
                {submission.attempt ? `Submission ${submission.attempt} · ` : ''}
                {resultLabel(submission.correct)}
              </span>
              <span className="text-muted-foreground ms-auto flex items-center gap-3">
                {index === 0 ? (
                  <span className="text-foreground font-medium">First</span>
                ) : (
                  <span>{elapsed}</span>
                )}
                {submission.fileName ? (
                  <a
                    className="underline"
                    href={apiPaths.files.submission(encodeURIComponent(submission.fileName), {
                      download: true,
                    })}
                    download={submission.originalFileName ?? 'submission'}
                  >
                    Open<span className="sr-only"> {name}&apos;s submission</span>
                  </a>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => onCompare(students)}>
          Compare submissions
          <span className="sr-only">
            {' '}
            for {students.map((submission) => studentName(submission.student)).join(' and ')}
          </span>
        </Button>
      </div>
    </article>
  );
}
