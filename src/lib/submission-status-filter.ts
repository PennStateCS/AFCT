/**
 * The status values a submission can be filtered by.
 *
 * Only the type survives. `STATUS_FILTER_OPTIONS`, `getSubmissionReviewStatus` and
 * `filterSubmissions` went on 2026-08-14 with nothing importing them: the Submissions page moved
 * to DataTable's own Filters popover, which builds its options from the column, and the bespoke
 * filtering here stopped being called. The options list carried seven raw Tailwind dot colours,
 * the only ones in this file, none of which had a dark-mode pairing.
 */
export type SubmissionStatusFilter =
  | 'on-time'
  | 'late'
  | 'pending'
  | 'processing'
  | 'failed'
  | 'correct'
  | 'incorrect';
