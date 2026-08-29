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

// Semantic-but-restrained colours from the app's badge palette (full light/dark support).
// completed = positive, processing = informational, pending = warning (in the queue),
// failed = destructive, missing = muted.
const STATUS_STYLE: Record<StatusKey, string> = {
  completed: 'bg-badge-success',
  processing: 'bg-badge-info',
  pending: 'bg-badge-warning',
  failed: 'bg-badge-danger',
  missing: 'bg-badge-neutral',
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
