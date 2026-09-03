'use client';

import { GRADING_LABELS, GRADING_ORDER, type GradingStateKey } from '@/lib/assignment-statistics';
import { SegmentedBarChart } from './SegmentedBarChart';

export type GradingSeries = {
  id: string;
  /** Row label, e.g. a problem title. */
  label: string;
  grading: { key: GradingStateKey; count: number }[];
};

type Props = {
  /** One 100% bar per entry (per problem). */
  series: GradingSeries[];
  /** Total assigned participants (the denominator for every row). */
  total: number;
  /** e.g. "students" or "groups". */
  unitPlural: string;
  /**
   * What one row is, for the data table's first column. Problems on an assignment page,
   * assignments on a course one: a screen reader should hear which it is being read.
   */
  rowHeader?: string;
};

// graded = settled, regrade needed = worth another look, awaiting grading = waiting on a
// person, nothing submitted = muted, because nobody can grade what is not there.
const GRADING_STYLE: Record<GradingStateKey, string> = {
  graded: 'bg-status-success-solid',
  'graded-stale': 'bg-status-warning-solid',
  'ungraded-submitted': 'bg-status-info-solid',
  'ungraded-missing': 'bg-status-neutral-solid',
};

/**
 * What is graded, what is waiting, and what never arrived.
 *
 * The question the queue chart looks like it answers and does not. On a hand-graded problem
 * this is the marking queue; on an autograded one it is mostly settled the moment a
 * submission lands, and anything sitting in "awaiting grading" there is worth a look.
 */
export function GradingProgressBar({ series, total, unitPlural, rowHeader = 'Problem' }: Props) {
  return (
    <SegmentedBarChart
      series={series.map((row) => ({ id: row.id, label: row.label, segments: row.grading }))}
      total={total}
      unitPlural={unitPlural}
      order={GRADING_ORDER}
      labels={GRADING_LABELS}
      styles={GRADING_STYLE}
      rowLabel="Grading progress"
      caption={`Grading progress per ${rowHeader.toLowerCase()}, across ${total} ${unitPlural}.`}
      rowHeader={rowHeader}
    />
  );
}
