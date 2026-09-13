import type { ProblemSubmission } from '@/lib/problem-submission';

/**
 * Which of the Badge component's tinted colour pairs a chip wears when it is rendered as
 * a badge (see StatusBadge). These are the app's contrast-checked tokens, so there are
 * only five: the mapping below spends them so the values that share a column stay
 * distinct. Failed is the only red in the grading column, because it means the autograder
 * itself broke and needs staff; a merely Incorrect answer is an ordinary student outcome
 * and would be overstated in the same colour.
 */
export type StatusBadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * One status, as the table renders it.
 *
 * There used to be a `tone` here and a `statusToneClass` map of nine dot colours beside it. Both
 * went on 2026-08-14: nothing read them. A dot conveying meaning by colour alone is not a
 * conveyance anyone can rely on, so the tables moved to a badge whose *text* carries the status
 * (see the note in ProblemWorkspace), and the colours were left behind as the only raw Tailwind
 * palette in this file. If a dot ever comes back it needs a token and a label, not nine shades.
 */
export type StatusChip = {
  label: string;
  title: string;
  variant: StatusBadgeVariant;
};

/**
 * On time or late, decided by comparing the attempt against the deadline the submitter was
 * held to. `dueDate` must be that student's *effective* deadline, override applied, not the
 * assignment's own.
 *
 * There used to be a `submission.status === 'late'` arm ahead of the comparison, on the
 * understanding that the server had already decided and its answer should win. It never had:
 * `SubmissionStatus` is PENDING, PROCESSING, COMPLETED or FAILED, so nothing ever stored
 * "late" and the arm could not fire. Its presence made a missing due date look survivable,
 * which is how the staff Submissions tab came to call every attempt on time for months. If
 * the server's decision should be authoritative here, and there is a case for it, that means
 * storing what `evaluateSubmissionWindow` decided, not reading a value nothing writes.
 */
export const getTimingStatusChip = (
  submission: ProblemSubmission,
  hasValidDueDate: boolean,
  dueDate: Date | null,
): StatusChip => {
  const submittedAt = new Date(submission.submittedAt);
  const isLate = hasValidDueDate && !!dueDate && submittedAt.getTime() > dueDate.getTime();

  if (isLate) {
    return {
      label: 'Late',
      title: 'Submitted after due date',
      variant: 'warning',
    };
  }

  return {
    label: 'On time',
    title: 'Submitted before due date',
    variant: 'success',
  };
};

export const getReviewStatusChip = (submission: ProblemSubmission): StatusChip => {
  const subm_status = submission.status?.toLowerCase() ?? '';
  if (subm_status === 'pending') {
    return {
      label: 'Pending',
      title: 'Submission analysis is pending',
      variant: 'neutral',
    };
  }

  if (subm_status === 'processing') {
    return {
      label: 'Processing',
      title: 'Submission is being processed',
      variant: 'info',
    };
  }

  if (subm_status === 'failed') {
    return {
      label: 'Failed',
      title: 'Submission analysis failed',
      variant: 'danger',
    };
  }

  if (submission.correct == true) {
    return {
      label: 'Correct',
      title: 'Submission is correct',
      variant: 'success',
    };
  }

  return {
    label: 'Incorrect',
    title: 'Submission is incorrect',
    variant: 'warning',
  }
};
