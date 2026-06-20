import type { ProblemSubmission } from '@/lib/problem-submission';

export type SubmissionStatusFilter =
  | 'on-time'
  | 'late'
  | 'pending'
  | 'processing'
  | 'failed'
  | 'correct'
  | 'incorrect';

export const STATUS_FILTER_OPTIONS: { value: SubmissionStatusFilter; label: string; dot: string }[] = [
  { value: 'on-time', label: 'On time', dot: 'bg-emerald-500' },
  { value: 'late', label: 'Late', dot: 'bg-amber-500' },
  { value: 'pending', label: 'Pending', dot: 'bg-violet-500' },
  { value: 'processing', label: 'Processing', dot: 'bg-yellow-300' },
  { value: 'failed', label: 'Failed', dot: 'bg-pink-500' },
  { value: 'correct', label: 'Correct', dot: 'bg-sky-500' },
  { value: 'incorrect', label: 'Incorrect', dot: 'bg-rose-500' },
];

export const getSubmissionReviewStatus = (submission: ProblemSubmission): string => {
  const subm_status = submission.status?.toLowerCase() ?? '';
  if (subm_status === 'processing') return 'processing';
  if (subm_status === 'pending') return 'pending';
  if (subm_status === 'failed') return 'failed';
  if (submission.correct === true) return 'correct';
  return 'incorrect';
};

export const filterSubmissions = (
  submissions: ProblemSubmission[],
  activeFilters: Set<SubmissionStatusFilter>,
  dueDate: Date | null,
  hasValidDueDate: boolean,
): ProblemSubmission[] => {
  if (activeFilters.size === 0) return submissions;
  return submissions.filter((s) => {
    const reviewStatus = getSubmissionReviewStatus(s);
    const submittedAt = new Date(s.submittedAt);
    const isLate =
      s.status?.toLowerCase() === 'late' ||
      (hasValidDueDate && !!dueDate && submittedAt.getTime() > dueDate.getTime());

    if (activeFilters.has('late') && isLate) return true;
    if (activeFilters.has('on-time') && !isLate) return true;
    if (activeFilters.has(reviewStatus as SubmissionStatusFilter)) return true;
    return false;
  });
};
