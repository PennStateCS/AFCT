'use client';

import { STATUS_LABELS, STATUS_ORDER, type StatusKey } from '@/lib/assignment-statistics';
import { SegmentedBarChart } from './SegmentedBarChart';

export type StatusSeries = {
  id: string;
  /** Row label, e.g. a problem title. */
  label: string;
  status: { key: StatusKey; count: number }[];
};

type Props = {
  /** One 100% status bar per entry (per problem). */
  series: StatusSeries[];
  /** Total assigned participants (the denominator for every row). */
  total: number;
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

// The solid status fills, which is the family meant for a filled swatch. These bars used the
// badge palette, whose colours are the *text* weight of each state: dark green, near-black red,
// navy. At the size of a status bar that read as heavy rather than as meaning, and it is not
// what those tokens are for. The meanings are unchanged: completed = positive, processing =
// informational, pending = warning (in the queue), failed = destructive, missing = muted.
const STATUS_STYLE: Record<StatusKey, string> = {
  completed: 'bg-status-success-solid',
  processing: 'bg-status-info-solid',
  pending: 'bg-status-warning-solid',
  failed: 'bg-status-danger-solid',
  missing: 'bg-status-neutral-solid',
};

/**
 * Where each participant's latest submission sits in the evaluation queue.
 *
 * This is the autograder's plumbing, not anybody's progress: on a problem a person marks it
 * reads "Completed" the moment the file has been looked at, with nothing graded. The tab
 * shows it while work is actually moving through the queue and reads progress off the
 * grading card instead.
 */
export function SubmissionStatusBar({ series, total, unitPlural }: Props) {
  return (
    <SegmentedBarChart
      series={series.map((row) => ({ id: row.id, label: row.label, segments: row.status }))}
      total={total}
      unitPlural={unitPlural}
      order={STATUS_ORDER}
      labels={STATUS_LABELS}
      styles={STATUS_STYLE}
      rowLabel="Submission status"
      caption={`Submission status per problem, across ${total} ${unitPlural}.`}
      rowHeader="Problem"
    />
  );
}
