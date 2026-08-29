'use client';

import { apiPaths } from '@/lib/api-paths';
import type { MatchSubmission } from '@/lib/similarity/matches';
import {
  attemptLabel,
  elapsedLabel,
  resultLabel,
  studentName,
  type ReviewSubject,
} from './similarity-format';

/** The middle dot between facts on a phone. The desktop grid separates them by column. */
function Dot() {
  return (
    <span aria-hidden="true" className="sm:hidden">
      ·
    </span>
  );
}

/**
 * The attempts that matched: what was sent, by whom, when, and how it was graded.
 *
 * One row per SUBMISSION, not per student. A problem can allow several attempts, and which
 * one matched is the thing a reader is being asked about: a student whose second and fourth
 * attempts both turn up here has two rows, and collapsing them would hide the attempt the
 * finding is actually about. Attempts that had nothing to do with the match never appear.
 *
 * On a group assignment the group is the subject, because any member may submit for the
 * team. Who pressed the button is kept as secondary detail rather than dropped: it is
 * useful, and it is not a claim that the work is theirs alone.
 *
 * An ordered list with every field written out, because the order and the intervals are half
 * of what a reader is here for and none of it may depend on lines, colour or position. The
 * date appears only when the attempts run across more than one day, so an ordinary evening
 * of submissions reads as times.
 */
export function SimilarityTimeline({
  attempts,
  subject,
  formatDay,
  formatTime,
}: {
  attempts: MatchSubmission[];
  subject: ReviewSubject;
  formatDay: (iso: string) => string;
  formatTime: (iso: string) => string;
}) {
  const firstAt = attempts[0] ? Date.parse(attempts[0].submittedAt) : 0;
  const spansDays = new Set(attempts.map((a) => formatDay(a.submittedAt))).size > 1;

  return (
    <ol aria-label="Matching attempts, earliest first" className="divide-border divide-y text-sm">
      {attempts.map((submission, index) => {
        const name = studentName(submission.student);
        // The group leads on a group assignment, but only when this attempt actually has one:
        // a submission with no group is described by the person who sent it, whatever the
        // assignment is set to.
        const group = subject === 'group' ? submission.studentGroup : null;
        const primary = group ? group.name : name;

        return (
          <li
            key={submission.id}
            /*
             * Two lines on a phone, one row on a desktop, from one piece of markup.
             * `sm:contents` dissolves the wrapper below so its children become cells of this
             * grid, which keeps the columns aligned across rows without rendering the same
             * facts twice for a screen reader to read out twice.
             */
            className="flex flex-col gap-y-0.5 py-2 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[minmax(9rem,1.4fr)_auto_auto_auto_auto_auto] sm:items-baseline sm:gap-x-4"
          >
            <span className="font-medium">
              {primary}
              {group ? (
                <span className="text-muted-foreground block text-xs font-normal">
                  Submitted by {name}
                </span>
              ) : null}
            </span>

            <span className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-xs sm:contents sm:text-sm">
              <span className="tabular-nums">{attemptLabel(submission.attempt)}</span>
              <Dot />

              <time dateTime={submission.submittedAt} className="tabular-nums">
                {spansDays
                  ? `${formatDay(submission.submittedAt)} ${formatTime(submission.submittedAt)}`
                  : formatTime(submission.submittedAt)}
              </time>
              <Dot />

              <span>{resultLabel(submission.correct)}</span>
              <Dot />

              <span className="tabular-nums sm:text-right">
                {index === 0 ? (
                  <span className="text-foreground font-medium">First</span>
                ) : (
                  elapsedLabel(Date.parse(submission.submittedAt) - firstAt)
                )}
              </span>

              {submission.fileName ? (
                <>
                  <Dot />
                  <a
                    className="underline sm:justify-self-end"
                    href={apiPaths.files.submission(encodeURIComponent(submission.fileName), {
                      download: true,
                    })}
                    download={submission.originalFileName ?? 'submission'}
                  >
                    Open
                    <span className="sr-only">
                      {' '}
                      {primary}&apos;s {attemptLabel(submission.attempt).toLowerCase()}
                    </span>
                  </a>
                </>
              ) : (
                <span aria-hidden="true" />
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
