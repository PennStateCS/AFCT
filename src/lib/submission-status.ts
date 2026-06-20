import type { ProblemSubmission } from '@/lib/problem-submission';

export type StatusTone =
  | 'green'
  | 'amber'
  | 'red'
  | 'gray'
  | 'blue'
  | 'violet'
  | 'yellow'
  | 'lime'
  | 'pink';

export type StatusChip = {
  label: string;
  tone: StatusTone;
  title: string;
};

export const statusToneClass: Record<StatusTone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  gray: 'bg-slate-400',
  blue: 'bg-sky-500',
  violet: 'bg-violet-500',
  yellow: 'bg-yellow-300',
  lime: 'bg-lime-400',
  pink: 'bg-pink-500',
};

export const getTimingStatusChip = (
  submission: ProblemSubmission,
  hasValidDueDate: boolean,
  dueDate: Date | null,
): StatusChip => {
  const submittedAt = new Date(submission.submittedAt);
  const isLate =
    submission.status?.toLowerCase() === 'late' ||
    (hasValidDueDate && !!dueDate && submittedAt.getTime() > dueDate.getTime());

  if (isLate) {
    return {
      label: 'Late',
      tone: 'amber',
      title: 'Submitted after due date',
    };
  }

  return {
    label: 'On time',
    tone: 'green',
    title: 'Submitted before due date',
  };
};

export const getReviewStatusChip = (submission: ProblemSubmission): StatusChip => {
  const subm_status = submission.status?.toLowerCase() ?? '';
  if (subm_status === 'pending') {
    return {
      label: 'Pending',
      tone: 'violet',
      title: 'Submission analysis is pending',
    };
  }

  if (subm_status === 'processing') {
    return {
      label: 'Processing',
      tone: 'yellow',
      title: 'Submission is being processed',
    };
  }

  if (subm_status === 'failed') {
    return {
      label: 'Failed',
      tone: 'pink',
      title: 'Submission analysis failed',
    };
  }
  
  if (submission.correct == true) {
    return {
      label: 'Correct',
      tone: 'blue',
      title: 'Submission is correct',
    };
  }

  return {
    label: 'Incorrect',
    tone: 'red',
    title: 'Submission is incorrect',
  }
};
