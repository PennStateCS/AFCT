'use client';

import { apiPaths } from '@/lib/api-paths';
import type { MatchSubmission } from '@/lib/similarity/matches';
import { elapsedLabel, resultLabel, studentName } from './similarity-format';

/**
 * Who submitted, when, and how long after the first.
 *
 * An ordered list with every relationship written out, because the order and the intervals
 * are half of what a reader is here for and none of it may depend on lines, colour or
 * position to be understood. The date appears only when the group runs across more than one
 * day, so an ordinary evening of submissions reads as times.
 */
export function SimilarityTimeline({
  students,
  formatDay,
  formatTime,
}: {
  students: MatchSubmission[];
  formatDay: (iso: string) => string;
  formatTime: (iso: string) => string;
}) {
  const firstAt = students[0] ? Date.parse(students[0].submittedAt) : 0;
  const spansDays = new Set(students.map((s) => formatDay(s.submittedAt))).size > 1;

  return (
    <ol aria-label="Submission order" className="divide-border divide-y text-sm">
      {students.map((submission, index) => {
        const name = studentName(submission.student);
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
                <span>{elapsedLabel(Date.parse(submission.submittedAt) - firstAt)}</span>
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
  );
}
