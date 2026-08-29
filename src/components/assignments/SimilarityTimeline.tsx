'use client';

import { CircleCheck, CircleX, CircleDashed, FileDown } from 'lucide-react';
import { apiPaths } from '@/lib/api-paths';
import type { MatchSubmission } from '@/lib/similarity/matches';
import {
  attemptLabel,
  elapsedLabel,
  resultLabel,
  studentName,
  type ReviewSubject,
} from './similarity-format';

/**
 * The whole list is one grid and every row dissolves into it (`sm:contents`), which is what
 * makes the columns line up down the card while each one is only as wide as it needs to be.
 *
 * Fixed column widths would align too, but they cannot shrink: on a tablet the row ran past
 * the edge of the card. Auto columns cannot, and the subject column takes whatever is left.
 * Below `sm` none of this applies and each attempt stacks into two lines.
 */
const LIST_GRID = 'sm:grid sm:grid-cols-[minmax(8rem,22rem)_auto_auto_auto_auto_minmax(4rem,1fr)]';

/**
 * Each cell carries the row's rule and padding, because the row itself has no box at `sm`.
 * The columns are separated by padding rather than a grid gap so the rules meet and read as
 * one line across the row instead of as five dashes, and each cell is made block-level so it
 * fills its column: an inline cell is only as wide as its text, and the rule under a short
 * "Correct" stopped short of the one beside it.
 */
const CELL_BASE = 'sm:border-t sm:py-2 sm:pe-3 sm:whitespace-nowrap';
const CELL = `sm:block ${CELL_BASE}`;

/** The middle dot between facts on a phone. The desktop grid separates them by column. */
function Dot() {
  return (
    <span aria-hidden="true" className="sm:hidden">
      ·
    </span>
  );
}

/** What the autograder made of an attempt: an icon reinforcing a word, never a colour alone. */
function Result({ correct, className = '' }: { correct: boolean | null; className?: string }) {
  const Icon = correct === true ? CircleCheck : correct === false ? CircleX : CircleDashed;
  const tone =
    correct === true
      ? 'text-badge-success'
      : correct === false
        ? 'text-badge-danger'
        : 'text-muted-foreground';

  return (
    <span className={`inline-flex items-center gap-1.5 sm:flex ${className}`}>
      <Icon className={`size-3.5 shrink-0 ${tone}`} aria-hidden="true" />
      {resultLabel(correct)}
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
    <ol aria-label="Matching attempts, earliest first" className={`text-sm ${LIST_GRID}`}>
      {/*
        Column names, on a wide screen only, and hidden from assistive technology: every row
        already says "Attempt 2" and "Correct" in full, so reading the headings as well would
        be repeating each row before hearing it. It lives inside the grid because that is the
        only way its columns can be the same columns.
      */}
      <li
        aria-hidden="true"
        className="text-muted-foreground hidden pb-1 text-xs font-medium sm:contents"
      >
        <span className="sm:pe-3 sm:pb-1">{subject === 'group' ? 'Group' : 'Student'}</span>
        <span className="sm:pe-3 sm:pb-1">Attempt</span>
        <span className="sm:pe-3 sm:pb-1">Submitted</span>
        <span className="sm:pe-3 sm:pb-1">Result</span>
        <span className="sm:pe-3 sm:pb-1">Relative</span>
        <span className="sm:pb-1 sm:text-right">Open</span>
      </li>

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
             * Two lines on a phone, one row of the grid on a desktop, from one piece of
             * markup: `sm:contents` dissolves this box so its cells become the grid's own,
             * which keeps the columns aligned without rendering the same facts twice for a
             * screen reader to read out twice.
             */
            className="flex flex-col gap-y-0.5 border-t py-2 sm:contents"
          >
            <span className={`font-medium ${CELL}`}>
              {primary}
              {group ? (
                <span className="text-muted-foreground block text-xs font-normal">
                  Submitted by {name}
                </span>
              ) : null}
            </span>

            <span className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-xs sm:contents sm:text-sm">
              <span className={`tabular-nums ${CELL}`}>{attemptLabel(submission.attempt)}</span>
              <Dot />

              <time dateTime={submission.submittedAt} className={`tabular-nums ${CELL}`}>
                {spansDays
                  ? `${formatDay(submission.submittedAt)} ${formatTime(submission.submittedAt)}`
                  : formatTime(submission.submittedAt)}
              </time>
              <Dot />

              <Result correct={submission.correct} className={CELL_BASE} />
              <Dot />

              <span className={`tabular-nums ${CELL}`}>
                {index === 0 ? (
                  <span className="text-foreground font-medium">First</span>
                ) : (
                  elapsedLabel(Date.parse(submission.submittedAt) - firstAt)
                )}
              </span>

              {submission.fileName ? (
                <>
                  <Dot />
                  {/* Wrapped so the cell itself fills its column: an anchor sized to its own
                      text would leave the row's rule stopping short of the edge. */}
                  <span className={`${CELL} sm:pe-0 sm:text-right`}>
                    <a
                      className="text-primary inline-flex items-center gap-1 underline-offset-2 hover:underline"
                      href={apiPaths.files.submission(encodeURIComponent(submission.fileName), {
                        download: true,
                      })}
                      download={submission.originalFileName ?? 'submission'}
                    >
                      <FileDown className="size-3.5 shrink-0" aria-hidden="true" />
                      Open
                      <span className="sr-only">
                        {' '}
                        {primary}&apos;s {attemptLabel(submission.attempt).toLowerCase()}
                      </span>
                    </a>
                  </span>
                </>
              ) : (
                <span aria-hidden="true" className={`${CELL} sm:pe-0`} />
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
