'use client';

import { TURN_IN_LABELS, TURN_IN_ORDER, type TurnInStateKey } from '@/lib/assignment-statistics';
import { SegmentedBarChart } from './SegmentedBarChart';

export type TurnInSeries = {
  id: string;
  /** Row label, e.g. a problem title. */
  label: string;
  turnIn: { key: TurnInStateKey; count: number }[];
};

type Props = {
  /** One 100% bar per entry (per problem). */
  series: TurnInSeries[];
  /** Total assigned participants (the denominator for every row). */
  total: number;
  /** e.g. "students" or "groups". */
  unitPlural: string;
};

// On time reads as settled, a late revision as worth a look, late as the thing a late policy
// is about, and nothing submitted as absent rather than as an offence.
const TURN_IN_STYLE: Record<TurnInStateKey, string> = {
  'on-time': 'bg-badge-success',
  'revised-late': 'bg-badge-warning',
  late: 'bg-badge-danger',
  missing: 'bg-badge-neutral',
};

/**
 * Whether the work arrived by each participant's own deadline.
 *
 * Every bar is measured against the date that participant is actually held to, so a student
 * with an extension is on time on their own terms. It reports what happened and when: what a
 * late submission costs is the professor's policy, and this page has no opinion about it.
 */
export function TurnInStatusBar({ series, total, unitPlural }: Props) {
  return (
    <SegmentedBarChart
      series={series.map((row) => ({ id: row.id, label: row.label, segments: row.turnIn }))}
      total={total}
      unitPlural={unitPlural}
      order={TURN_IN_ORDER}
      labels={TURN_IN_LABELS}
      styles={TURN_IN_STYLE}
      rowLabel="Turn-in status"
      caption={`Turn-in status per problem, across ${total} ${unitPlural}.`}
      rowHeader="Problem"
    />
  );
}
